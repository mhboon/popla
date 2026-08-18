# Working conventions for this repo

`SPEC.md` and `ARCHITECTURE.md` cover the *what* (domain rules, system
design). This file covers *how* to work in the repo — read it before
making changes.

## Stack

- Infra is AWS CDK (TypeScript), in `infra/`. Don't hand-write
  CloudFormation, SAM, Terraform, or use the CDK CLI's other language
  bindings — everything is CDK TypeScript.
- Target architecture is AWS serverless: AppSync (GraphQL) + Cognito,
  DynamoDB, Lambda, CloudFront + S3. See `ARCHITECTURE.md` for the
  native-vs-Lambda AppSync resolver split — default to a native JS
  resolver straight to DynamoDB; reach for a Lambda resolver only when
  there's real logic (an algorithm, a multi-step computation), not for
  convenience.
- No AWS account IDs, role ARNs, or other account-specific values in
  committed code, ever. CDK stacks stay environment-agnostic (no explicit
  `env:` on a stack) so they resolve account/region from whichever
  credentials are deploying. Anything account-specific lives only in
  GitHub Actions secrets. See `README.md` and
  `infra/lib/github-oidc-stack.ts` for the reasoning — it's not just "the
  repo is public," it also covers keeping the account ID out of CI log
  output via GitHub's secret-masking.

## Git workflow

- Never push directly to `main`. `main` is branch-protected (PR required,
  enforced for admins too) — every change, however small, goes through a
  branch and a PR.
- One concern per PR/branch — don't bundle an unrelated doc update into a
  feature branch.

### Branch and PR naming

Both follow [Conventional Commits](https://www.conventionalcommits.org/),
so the PR title doubles as the squash-merge commit subject and reads
directly as a semantic-versioning bump — whether or not a release
automation tool is wired up yet:

- Branch: `<type>/<short-kebab-description>` — e.g.
  `feat/matchday-close-mutation`, `fix/rank-tiebreak`.
- PR title: `<type>[!]: <description>` — same `type`, imperative,
  lowercase, no trailing period.

| type | meaning | semver bump |
|---|---|---|
| `feat` | new capability | minor |
| `fix` | bug fix | patch |
| `perf` | performance improvement | patch |
| `refactor` | code change, no behavior change | none |
| `docs` | documentation only | none |
| `chore` | tooling, deps, CI config | none |
| `test` | tests only | none |
| any type suffixed `!` (e.g. `feat!:`), or a `BREAKING CHANGE:` footer in the PR body | breaking change | major |

Pick the type by the change's *effect*, not the size of the diff — a
one-line change to a mutation's contract is `fix!`/`feat!`, not `chore`,
even if it's a tiny diff.
