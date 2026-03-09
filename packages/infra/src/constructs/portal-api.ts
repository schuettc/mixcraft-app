import { Duration } from 'aws-cdk-lib';
import {
  CorsHttpMethod,
  DomainName,
  HttpApi,
  HttpMethod,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import type * as kms from 'aws-cdk-lib/aws-kms';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface PortalApiConstructProps {
  usersTable: Table;
  apiKeysTable: Table;
  userMusicTokensTable: Table;
  tokenEncryptionKey: kms.Key;
  appleTeamIdSecret: secretsmanager.ISecret;
  appleKeyIdSecret: secretsmanager.ISecret;
  applePrivateKeySecret: secretsmanager.ISecret;
  clerkSecretKey: secretsmanager.ISecret;
  clerkWebhookSecret: secretsmanager.ISecret;
  portalUrl: string;
  apiDomainName: string;
  hostedZone: route53.IHostedZone;
  certificate: certificatemanager.ICertificate;
  environment: string;
}

export class PortalApiConstruct extends Construct {
  public readonly httpApi: HttpApi;
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: PortalApiConstructProps) {
    super(scope, id);

    const portalApiFunction = new NodejsFunction(this, 'PortalApiFunction', {
      entry: path.join(
        __dirname,
        '..',
        '..',
        '..',
        'portal-api',
        'src',
        'index.ts',
      ),
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: {
        USERS_TABLE_NAME: props.usersTable.tableName,
        API_KEYS_TABLE_NAME: props.apiKeysTable.tableName,
        USER_MUSIC_TOKENS_TABLE_NAME: props.userMusicTokensTable.tableName,
        TOKEN_ENCRYPTION_KEY_ARN: props.tokenEncryptionKey.keyArn,
        APPLE_TEAM_ID_SECRET_NAME: props.appleTeamIdSecret.secretName,
        APPLE_KEY_ID_SECRET_NAME: props.appleKeyIdSecret.secretName,
        APPLE_PRIVATE_KEY_SECRET_NAME: props.applePrivateKeySecret.secretName,
        CLERK_SECRET_KEY_NAME: props.clerkSecretKey.secretName,
        CLERK_WEBHOOK_SECRET_NAME: props.clerkWebhookSecret.secretName,
        PORTAL_URL: props.portalUrl,
        REGION: process.env.CDK_DEFAULT_REGION || 'us-east-1',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
      },
    });

    // Grants
    props.usersTable.grantReadWriteData(portalApiFunction);
    props.apiKeysTable.grantReadWriteData(portalApiFunction);
    props.userMusicTokensTable.grantReadWriteData(portalApiFunction);
    props.tokenEncryptionKey.grantEncryptDecrypt(portalApiFunction);
    props.appleTeamIdSecret.grantRead(portalApiFunction);
    props.appleKeyIdSecret.grantRead(portalApiFunction);
    props.applePrivateKeySecret.grantRead(portalApiFunction);
    props.clerkSecretKey.grantRead(portalApiFunction);
    props.clerkWebhookSecret.grantRead(portalApiFunction);

    // Custom domain for API Gateway
    const domainName = new DomainName(this, 'ApiDomainName', {
      domainName: props.apiDomainName,
      certificate: props.certificate,
    });

    // HTTP API with CORS
    this.httpApi = new HttpApi(this, 'PortalHttpApi', {
      apiName: `mixcraft-portal-api-${props.environment}`,
      defaultDomainMapping: {
        domainName,
      },
      corsPreflight: {
        allowOrigins: [props.portalUrl],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    this.apiUrl = `https://${props.apiDomainName}`;

    this.httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration(
        'PortalApiIntegration',
        portalApiFunction,
      ),
    });

    // Route53 A record pointing to API Gateway custom domain
    new route53.ARecord(this, 'ApiARecord', {
      zone: props.hostedZone,
      recordName: props.apiDomainName,
      target: route53.RecordTarget.fromAlias(
        new targets.ApiGatewayv2DomainProperties(
          domainName.regionalDomainName,
          domainName.regionalHostedZoneId,
        ),
      ),
    });
  }
}
