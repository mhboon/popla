#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PoplaBackendStack } from '../lib/backend-stack';
import { PoplaWebStack } from '../lib/web-stack';
import { GithubOidcStack } from '../lib/github-oidc-stack';

const app = new cdk.App();

// No explicit `env` is set on any stack: CDK resolves the account/region
// from whatever credentials are active at deploy time (local `aws
// configure`/SSO, or the GitHub Actions OIDC role in CI). That keeps the
// AWS account number out of the source entirely, which matters because
// this repo is public.

new PoplaBackendStack(app, 'PoplaBackendStack');
new PoplaWebStack(app, 'PoplaWebStack');

// One-time manual bootstrap only — never part of the CI deploy. See
// lib/github-oidc-stack.ts for usage.
const githubRepo = app.node.tryGetContext('githubRepo');
if (githubRepo) {
  new GithubOidcStack(app, 'GithubOidcStack', { githubRepo });
}
