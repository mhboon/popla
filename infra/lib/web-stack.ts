import * as path from 'path';
import { Stack, StackProps, RemovalPolicy, CfnOutput, Duration, Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';

export class PoplaWebStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      removalPolicy: RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // What the page is allowed to load and talk to — everything else the
    // browser refuses. The sign-in tokens live in localStorage, readable
    // by any script on the page, so this is what limits the damage if a
    // script ever gets in that shouldn't be there (a compromised
    // dependency, a future injection bug): it can't be loaded from
    // elsewhere, and it can't send anything anywhere but the two AWS
    // endpoints below. Keep this list in step with what the app really
    // uses — a missing entry shows up as a console error in the browser
    // (which scripts/smoke-test.mjs fails the deploy on, for anything the
    // login page loads).
    //
    // connect-src names the region, not this deployment's own API ID:
    // this stack stays independent of PoplaBackendStack (it's deployed
    // after it, from the same credentials, hence the same region), and
    // "an AppSync API or Cognito in this region" is already a destination
    // an attacker can't use to collect stolen tokens without an AWS
    // account's worth of effort — pin it to the exact API URL if that
    // ever needs tightening.
    const contentSecurityPolicy = [
      "default-src 'self'",
      "script-src 'self'",
      // Google Fonts: the stylesheet comes from googleapis, the font
      // files it points at from gstatic (see web/index.html).
      "style-src 'self' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "img-src 'self' data:",
      `connect-src https://*.appsync-api.${Aws.REGION}.amazonaws.com https://cognito-idp.${Aws.REGION}.amazonaws.com`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      // No site may embed this one in a frame (clickjacking).
      "frame-ancestors 'none'",
    ].join('; ');

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'Security headers for the Popla Cup web app',
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy, override: true },
        // Browsers that have visited once go straight to HTTPS for a
        // year, without relying on the redirect below. No
        // includeSubdomains/preload: on the default cloudfront.net
        // domain neither means anything, and they're hard to walk back
        // on a custom domain later.
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: false,
          override: true,
        },
        // Older-browser equivalent of frame-ancestors above.
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        contentTypeOptions: { override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: securityHeaders,
      },
      // SPA routing: unknown paths fall back to index.html client-side router.
      errorResponses: [
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    // Deploys the Vite build output — `npm run build` in web/ must run
    // before `cdk deploy` (see .github/workflows/deploy.yml and
    // README.md). No custom domain yet — served from the default
    // CloudFront domain.
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../web/dist'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new CfnOutput(this, 'SiteUrl', {
      value: `https://${distribution.distributionDomainName}`,
    });
  }
}
