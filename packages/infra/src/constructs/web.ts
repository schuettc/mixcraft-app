import * as cdk from 'aws-cdk-lib';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface PortalConstructProps {
  domainName: string;
  hostedZone: route53.IHostedZone;
  certificate: certificatemanager.ICertificate;
  environment: string;
}

export class PortalConstruct extends Construct {
  public readonly distribution: cloudfront.Distribution;
  public readonly portalUrl: string;
  public readonly bucket: s3.Bucket;
  public readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: PortalConstructProps) {
    super(scope, id);

    // WAF WebACL — rate-based rule (blanket 1000 req/5min per IP)
    this.webAcl = new wafv2.CfnWebACL(this, 'PortalWebAcl', {
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `mixcraft-portal-waf-${props.environment}`,
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'RateLimit',
          priority: 1,
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `mixcraft-portal-rate-limit-${props.environment}`,
            sampledRequestsEnabled: true,
          },
          statement: {
            rateBasedStatement: {
              limit: 1000,
              aggregateKeyType: 'IP',
            },
          },
        },
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `mixcraft-portal-common-rules-${props.environment}`,
            sampledRequestsEnabled: true,
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
        },
      ],
    });

    // CSP and security response headers
    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      'SecurityHeaders',
      {
        securityHeadersBehavior: {
          contentSecurityPolicy: {
            contentSecurityPolicy: [
              "default-src 'self'",
              "script-src 'self' https://js-cdn.music.apple.com https://*.clerk.accounts.dev https://clerk.mixcraft.app",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "connect-src 'self' https://api.mixcraft.app https://*.clerk.accounts.dev https://*.clerk.com https://clerk.mixcraft.app",
              "img-src 'self' https://*.clerk.com https://img.clerk.com data:",
              "frame-src https://*.clerk.accounts.dev https://clerk.mixcraft.app",
              "font-src 'self' https://fonts.gstatic.com",
            ].join('; '),
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.days(365),
            includeSubdomains: true,
            override: true,
          },
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: true,
          },
        },
      },
    );

    // S3 bucket (private, no public access)
    this.bucket = new s3.Bucket(this, 'PortalBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront distribution with custom domain
    this.distribution = new cloudfront.Distribution(
      this,
      'PortalDistribution',
      {
        webAclId: this.webAcl.attrArn,
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy,
        },
        domainNames: [props.domainName],
        certificate: props.certificate,
        defaultRootObject: 'index.html',
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
          },
        ],
      },
    );

    this.portalUrl = `https://${props.domainName}`;

    // Route53 A record pointing to CloudFront
    new route53.ARecord(this, 'PortalARecord', {
      zone: props.hostedZone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(this.distribution),
      ),
    });
  }

  /**
   * Deploy portal dist/ and runtime config.json to S3.
   * Called after PortalApi is created so we have the API URL.
   */
  deployContent(portalApiUrl: string, clerkPublishableKey: string) {
    new s3deploy.BucketDeployment(this, 'DeployPortal', {
      sources: [
        s3deploy.Source.asset('../web/dist'),
        s3deploy.Source.jsonData('config.json', {
          portalApiUrl,
          clerkPublishableKey,
        }),
      ],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });
  }
}
