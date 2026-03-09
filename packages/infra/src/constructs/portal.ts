import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export interface PortalConstructProps {
  portalApiUrl: string;
  environment: string;
}

export class PortalConstruct extends Construct {
  public readonly distribution: cloudfront.Distribution;
  public readonly portalUrl: string;

  constructor(scope: Construct, id: string, props: PortalConstructProps) {
    super(scope, id);

    // S3 bucket (private, no public access)
    const bucket = new s3.Bucket(this, 'PortalBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront distribution
    this.distribution = new cloudfront.Distribution(
      this,
      'PortalDistribution',
      {
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
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

    this.portalUrl = `https://${this.distribution.distributionDomainName}`;

    // Deploy portal dist/ to S3
    new s3deploy.BucketDeployment(this, 'DeployPortal', {
      sources: [s3deploy.Source.asset('../portal/dist')],
      destinationBucket: bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });
  }
}
