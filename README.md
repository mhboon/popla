# Popla Cup

Weekly padel tournament tracker. See [`SPEC.md`](SPEC.md) for the domain
rules and [`ARCHITECTURE.md`](ARCHITECTURE.md) for the system design.

## Repo layout

- `infra/` — AWS CDK app (TypeScript): DynamoDB tables, Cognito, AppSync
  API (native JS resolvers + two Lambda resolvers), and the S3/CloudFront
  web stack.
- `web/` — admin frontend: React + Vite + TypeScript, plain `fetch`-based
  GraphQL client (no Apollo — the API surface is small), Cognito login via
  `amazon-cognito-identity-js`.
- `.github/workflows/deploy.yml` — CI deploy on push to `main`.
- `.github/workflows/ci.yml` — lint check, required on every PR.
- `.github/workflows/codeql.yml` — CodeQL security scan, required on
  every PR (plus a weekly scheduled run).
- `.github/dependabot.yml` — weekly dependency-update PRs (npm and
  GitHub Actions), same required checks as any other PR.

## Local setup

```bash
nvm use            # Node LTS, see .nvmrc
npm install         # installs infra/ via the root workspace, and wires
                     # up the pre-commit lint hook (husky) automatically
cd infra
npx cdk synth        # sanity-check the app synthesizes
```

Linting (`infra/eslint.config.mjs`, TypeScript only — the AppSync JS
resolvers under `infra/graphql/resolvers/` run in AppSync's own
restricted runtime and aren't linted here) runs twice, on purpose:

- **Pre-commit**, via husky + lint-staged, against staged files only —
  fast local feedback, `--fix` applied automatically.
- **On every PR**, via `ci.yml`, against the full codebase — this is the
  one branch protection actually requires, so a skipped or bypassed local
  hook can't slip a lint failure through.

Deploying locally uses whatever AWS credentials are active in your shell
(`aws configure`, SSO, etc.) — no account ID is stored anywhere in this
repo:

```bash
cd infra
npx cdk bootstrap    # once per account/region
npx cdk deploy PoplaBackendStack
npx cdk deploy PoplaWebStack
```

### Frontend dev server

The frontend needs the deployed backend's AppSync/Cognito endpoints at
build time (baked into the static bundle — see `web/src/lib/config.ts`,
which fails fast with a clear error if they're missing). None of these
values are account-specific.

```bash
cd infra && npx cdk deploy PoplaBackendStack --outputs-file cdk-outputs.json
```

Copy the `ApiUrl`, `UserPoolId`, and `UserPoolClientId` from
`infra/cdk-outputs.json` into `web/.env.local` (copy from
`web/.env.example` first — `.env.local` is gitignored), then:

```bash
cd web
npm run dev
```

## CI/CD setup (one-time)

This repo is public, so CI deploys via GitHub's OIDC provider assuming an
IAM role — never via stored AWS access keys, and nothing account-specific
ever gets committed. That role only has `sts:AssumeRole` on the roles
`cdk bootstrap` already created in your account (see
`infra/lib/github-oidc-stack.ts`), not `AdministratorAccess` — so
`npx cdk bootstrap` (above) must have already been run in the target
account/region before step 1 below.

1. Bootstrap the OIDC trust + deploy role once, locally, with your own AWS
   credentials:

   ```bash
   cd infra
   npx cdk deploy GithubOidcStack -c githubRepo=<owner>/<repo> \
     -c githubOwnerId=<owner-id> -c githubRepoId=<repo-id>
   ```

   This prints a `DeployRoleArn` output.

   The role trusts exactly this one repo's `main` branch — the trust
   policy matches the OIDC token's subject literally, with no wildcards,
   so a look-alike repo name can't assume it. The two numeric IDs are
   what GitHub's immutable subject format carries
   (`repo:<owner>@<owner-id>/<repo>@<repo-id>:...` — the default for
   repos created after 2026-07-15, opt-in for older ones); look them up
   with:

   ```bash
   gh api repos/<owner>/<repo> --jq '"owner \(.owner.id), repo \(.id)"'
   ```

   Leave both `-c` ID options out only for a repo still on the older
   name-based subject (`repo:<owner>/<repo>:...`). Passing them is
   harmless either way — both forms of this repo's own subject are then
   trusted. If the Deploy workflow's "Configure AWS credentials" step
   fails with `Not authorized to perform sts:AssumeRoleWithWebIdentity`,
   the IDs are missing or wrong.

2. In the GitHub repo, add:
   - **Settings → Secrets and variables → Actions → Secrets**:
     `AWS_DEPLOY_ROLE_ARN` = the ARN printed above.
   - **Settings → Secrets and variables → Actions → Variables**:
     `AWS_REGION` = your target region (e.g. `eu-west-1`). Not sensitive,
     so it's a variable rather than a secret.

Because the role ARN is stored as a secret, GitHub automatically redacts
it — including the AWS account ID embedded in it — from all Actions log
output, even lines printed by `cdk deploy` itself (which otherwise prints
ARNs containing the account ID). This is what keeps the account number
out of a public repo's CI logs, not just out of the source code.

From here on, every push to `main` runs `.github/workflows/deploy.yml`.

## Admin users

Login is phone number + password, for everyone, admin and
participant alike (see `ARCHITECTURE.md`'s Auth section) — a Cognito
user's `Username` is their international phone number, digits only, no
leading `+` (e.g. `31612345678`, not `+31612345678`), and admin is just
`Admins`-group membership on top of an otherwise ordinary user. Existing
admins can promote/demote other registered participants through the
app's UI, but the *first* admin — and any "break-glass" admin not tied
to a participant record at all — has to be created manually:

```bash
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> \
  --username <international phone, no +, e.g. 31612345678> \
  --message-action SUPPRESS
aws cognito-idp admin-add-user-to-group --user-pool-id <UserPoolId> \
  --username <same-phone-number> --group-name Admins
```

(`UserPoolId` is printed as a stack output after deploying
`PoplaBackendStack`.) If this phone number should also be tied to a
participant record (so it shows up as a named player, not just a bare
login), register it as a participant through the app first — that
provisions the same Cognito user for you — then just run the
`admin-add-user-to-group` command above.

Note: `admin-create-user` here uses `--message-action SUPPRESS`, so
Cognito sends nothing and the new user has no password they know. Give
them a temporary one with the `admin-set-user-password` command below
(Resetting a password) — the app then asks them to choose their own on
first sign-in.

## Resetting a password

There is no self-service "forgot password" — an admin issues a temporary
password, and the app makes the user replace it at their next sign-in.
This is also how every new participant gets their first password.

From inside the app: open the participant's page and click **Reset
password** (see the admin manual). From outside the app — needed for the
very first admin, or if no admin can sign in:

```bash
aws cognito-idp admin-set-user-password --user-pool-id <UserPoolId> \
  --username <their phone, no +> --password <a temporary password>
```

Deliberately *without* `--permanent` — that leaves the user in
`FORCE_CHANGE_PASSWORD`. The next time they sign in with that temporary
password, the app takes them
straight to a "Set a new password" screen instead of logging them
in — choosing one there both replaces it and signs them in, in one step.
Same Cognito password policy as everywhere else (min. 8 characters,
upper/lowercase, a number, a symbol).

## Admin manual

A how-to manual for admins (starting/closing seasons, running a
matchday, managing participants and guests, promoting admins,
resetting passwords) is available two ways, both from the same content
(`web/src/content/adminManual.json`) so they can't drift apart:

- In-app, at `/manual` — admin-only, linked from the menu, with an
  English/Dutch toggle.
- As a PDF, committed at [`docs/admin-manual-en.pdf`](docs/admin-manual-en.pdf)
  and [`docs/admin-manual-nl.pdf`](docs/admin-manual-nl.pdf) — for
  printing or sharing with an admin who isn't at a screen.

Regenerate both PDFs (via Playwright, already a root dev dependency)
after editing the JSON content, and commit the result — nothing does
this automatically:

```bash
npm run docs:admin-manual
```

<!-- pipeline check: verifies the tightened OIDC deploy role can still assume from main -->
