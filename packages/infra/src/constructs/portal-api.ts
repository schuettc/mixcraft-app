import { Duration } from 'aws-cdk-lib';
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import type * as kms from 'aws-cdk-lib/aws-kms';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

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
  environment: string;
}

export class PortalApiConstruct extends Construct {
  public readonly httpApi: HttpApi;

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

    // HTTP API with CORS
    this.httpApi = new HttpApi(this, 'PortalHttpApi', {
      apiName: `music-mcp-portal-api-${props.environment}`,
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

    this.httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration(
        'PortalApiIntegration',
        portalApiFunction,
      ),
    });
  }
}
