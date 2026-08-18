# Popla Cup

Weekly padel tournament tracker. See [`SPEC.md`](SPEC.md) for the domain
rules and [`ARCHITECTURE.md`](ARCHITECTURE.md) for the system design.

## Repo layout

- `infra/` — AWS CDK app (TypeScript): DynamoDB tables, Cognito, AppSync
  API (native JS resolvers + two Lambda resolvers), and the S3/CloudFront
  web stack.
- `web/` — frontend (placeholder static page for now).
- `.github/workflows/deploy.yml` — CI deploy on push to `main`.

## Local setup

```bash
nvm use            # Node LTS, see .nvmrc
npm install         # installs infra/ via the root workspace
cd infra
npx cdk synth        # sanity-check the app synthesizes
```

Deploying locally uses whatever AWS credentials are active in your shell
(`aws configure`, SSO, etc.) — no account ID is stored anywhere in this
repo:

```bash
cd infra
npx cdk bootstrap    # once per account/region
npx cdk deploy PoplaBackendStack
npx cdk deploy PoplaWebStack
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
