import * as cdk from 'aws-cdk-lib';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
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

  constructor(scope: Construct, id: string, props: PortalConstructProps) {
    super(scope, id);

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
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
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
