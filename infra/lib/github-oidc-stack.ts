import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
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

    const deployRole = new iam.Role(this, 'GithubDeployRole', {
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:ref:refs/heads/main`,
        },
      }),
      description: 'Assumed by GitHub Actions to deploy the Popla Cup CDK stacks',
      // AdministratorAccess is the simplest starting point for a solo
      // project deploying via CDK (which needs broad CloudFormation/IAM
      // permissions anyway). Tighten to a scoped deploy policy later if
      // desired.
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
    });

    new CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
  }
}
