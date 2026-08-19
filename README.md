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
ever gets committed.

1. Bootstrap the OIDC trust + deploy role once, locally, with your own AWS
   credentials:

   ```bash
   cd infra
   npx cdk deploy GithubOidcStack -c githubRepo=<owner>/<repo>
   ```

   This prints a `DeployRoleArn` output.

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

Phase 1 has no self-signup. Create the first admin manually:

```bash
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> --username <email>
aws cognito-idp admin-add-user-to-group --user-pool-id <UserPoolId> \
  --username <email> --group-name Admins
```

(`UserPoolId` is printed as a stack output after deploying
`PoplaBackendStack`.)
