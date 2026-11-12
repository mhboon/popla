import { Stack, StackProps, CfnOutput, Aws, DefaultStackSynthesizer } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface GithubOidcStackProps extends StackProps {
  /** "owner/repo", e.g. "yourname/popla" */
  githubRepo: string;
  /**
   * The numeric GitHub IDs of the owner and the repo. Needed when the
   * repo issues GitHub's immutable OIDC subject
   * (`repo:<owner>@<ownerId>/<repo>@<repoId>:...` — the default for repos
   * created after 2026-07-15, opt-in for older ones); both or neither.
   */
  githubOwnerId?: string;
  githubRepoId?: string;
}

// GitHub's own naming rules. Checked here because these values end up in
// an IAM trust policy: nothing but a literal owner/repo name may reach it.
const GITHUB_REPO_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;
const GITHUB_ID_REGEX = /^[0-9]+$/;

/**
 * One-time bootstrap: creates the OIDC trust that lets GitHub Actions
 * assume a deploy role without any long-lived AWS access keys stored as
 * repo secrets. The trust policy is scoped by GitHub repo slug, not by
 * AWS account ID — nothing account-specific is ever written into this
 * (committed, public) source file.
 *
 * The trust matches the token's `sub` claim *exactly* (StringEquals, no
 * wildcards). A wildcard after the owner or repo name also matches
 * look-alike repos that anyone can create (`<owner>-x/<repo>`, or
 * `<owner>/<repo>-x`), which would leave the role's ARN as the
 * only thing standing between a stranger and this account's CDK
 * bootstrap roles.
 *
 * Deploy this stack yourself, once, with your own local AWS credentials:
 *   npx cdk deploy GithubOidcStack -c githubRepo=<owner>/<repo> \
 *     -c githubOwnerId=<id> -c githubRepoId=<id>
 * (see README.md for where the two IDs come from, and when they can be
 * left out).
 * Then copy the printed DeployRoleArn into a GitHub Actions secret named
 * AWS_DEPLOY_ROLE_ARN (Settings > Secrets and variables > Actions). CI
 * never creates or sees this stack — it only assumes the role via that
 * secret, which is why the secret mechanism matters: because the ARN is
 * registered as a GitHub secret, GitHub automatically redacts it (account
 * ID included) from all Actions log output, even output produced by
 * `cdk deploy` itself.
 */
export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const provider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    // GitHub can append immutable owner/repo IDs to the sub claim (e.g.
    // "repo:owner@123/repo@456:ref:..." instead of "repo:owner/repo:ref:..."),
    // depending on account-level OIDC settings outside this repo's control.
    // Wildcard right after the owner/repo names so the trust matches either
    // form without hardcoding those IDs into committed source.
    if (!GITHUB_REPO_REGEX.test(props.githubRepo)) {
      throw new Error(`githubRepo must be "<owner>/<repo>", got "${props.githubRepo}"`);
    }
    const { githubOwnerId, githubRepoId } = props;
    if ((githubOwnerId === undefined) !== (githubRepoId === undefined)) {
      throw new Error('githubOwnerId and githubRepoId must be given together');
    }
    for (const id of [githubOwnerId, githubRepoId]) {
      if (id !== undefined && !GITHUB_ID_REGEX.test(id)) {
        throw new Error(`GitHub IDs must be numeric, got "${id}"`);
      }
    }

    const [githubOwner, githubRepoName] = props.githubRepo.split('/');
    const ref = 'ref:refs/heads/main';
    // Both forms GitHub can issue for this one repo's main branch: the
    // name-based subject, and (only when the IDs were supplied) the
    // immutable one that carries the owner and repo IDs.
    const allowedSubjects = [`repo:${githubOwner}/${githubRepoName}:${ref}`];
    if (githubOwnerId !== undefined && githubRepoId !== undefined) {
      allowedSubjects.push(
        `repo:${githubOwner}@${githubOwnerId}/${githubRepoName}@${githubRepoId}:${ref}`
      );
    }

    const deployRole = new iam.Role(this, 'GithubDeployRole', {
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': allowedSubjects,
        },
      }),
      description: 'Assumed by GitHub Actions to deploy the Popla Cup CDK stacks',
    });

    // `cdk bootstrap` (run once per account/region, outside this stack)
    // creates a deploy-role and a file-publishing-role whose trust
    // policies allow any same-account principal with `sts:AssumeRole` to
    // assume them — that's the only permission this role needs. The
    // actual broad resource-creation permissions live on a separate
    // cfn-exec-role that `cdk deploy` passes to CloudFormation, but whose
    // trust policy only allows the CloudFormation *service* to assume it,
    // never this role directly. So even a compromised GitHub Actions run
    // can only ask CloudFormation to reconcile stacks (audited,
    // change-set-based) — it can't call arbitrary AWS APIs directly, e.g.
    // `iam:CreateAccessKey` to mint a persistent backdoor credential,
    // the way AdministratorAccess would allow.
    // Add lookup-role/image-publishing-role here too if this app ever
    // uses context lookups (e.g. `Vpc.fromLookup`) or Docker-bundled
    // assets — neither is used today.
    const bootstrapQualifier = DefaultStackSynthesizer.DEFAULT_QUALIFIER;
    const bootstrapRoleArn = (roleName: string) =>
      `arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:role/cdk-${bootstrapQualifier}-${roleName}-${Aws.ACCOUNT_ID}-${Aws.REGION}`;
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: [bootstrapRoleArn('deploy-role'), bootstrapRoleArn('file-publishing-role')],
      })
    );

    new CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
  }
}
