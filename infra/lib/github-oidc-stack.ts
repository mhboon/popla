import { Stack, StackProps, CfnOutput, Aws, DefaultStackSynthesizer } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface GithubOidcStackProps extends StackProps {
  /** "owner/repo", e.g. "yourname/popla" */
  githubRepo: string;
}

/**
 * One-time bootstrap: creates the OIDC trust that lets GitHub Actions
 * assume a deploy role without any long-lived AWS access keys stored as
 * repo secrets. The trust policy is scoped by GitHub repo slug, not by
 * AWS account ID — nothing account-specific is ever written into this
 * (committed, public) source file.
 *
 * Deploy this stack yourself, once, with your own local AWS credentials:
 *   npx cdk deploy GithubOidcStack -c githubRepo=<owner>/<repo>
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
    const [githubOwner, githubRepoName] = props.githubRepo.split('/');

    const deployRole = new iam.Role(this, 'GithubDeployRole', {
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${githubOwner}*/${githubRepoName}*:ref:refs/heads/main`,
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
