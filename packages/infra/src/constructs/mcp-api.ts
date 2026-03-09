import { Duration } from 'aws-cdk-lib';
import {
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

export interface McpApiConstructProps {
  usersTable: Table;
  apiKeysTable: Table;
  userMusicTokensTable: Table;
  tokenEncryptionKey: kms.Key;
  appleTeamIdSecret: secretsmanager.ISecret;
  appleKeyIdSecret: secretsmanager.ISecret;
  applePrivateKeySecret: secretsmanager.ISecret;
  environment: string;
}

export class McpApiConstruct extends Construct {
  public readonly httpApi: HttpApi;
  public readonly mcpFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: McpApiConstructProps) {
    super(scope, id);

    // Lambda: Node.js 20, bundled with esbuild via NodejsFunction
    this.mcpFunction = new NodejsFunction(this, 'McpFunction', {
      entry: path.join(__dirname, '..', '..', '..', 'server', 'src', 'index.ts'),
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: {
        USERS_TABLE_NAME: props.usersTable.tableName,
        API_KEYS_TABLE_NAME: props.apiKeysTable.tableName,
        USER_MUSIC_TOKENS_TABLE_NAME: props.userMusicTokensTable.tableName,
        KMS_KEY_ARN: props.tokenEncryptionKey.keyArn,
        APPLE_TEAM_ID_SECRET_NAME: props.appleTeamIdSecret.secretName,
        APPLE_KEY_ID_SECRET_NAME: props.appleKeyIdSecret.secretName,
        APPLE_PRIVATE_KEY_SECRET_NAME: props.applePrivateKeySecret.secretName,
        REGION: process.env.CDK_DEFAULT_REGION || 'us-east-1',
        ENVIRONMENT: props.environment,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
      },
    });

    // Grant Lambda: DynamoDB read/write on all tables
    props.usersTable.grantReadWriteData(this.mcpFunction);
    props.apiKeysTable.grantReadWriteData(this.mcpFunction);
    props.userMusicTokensTable.grantReadWriteData(this.mcpFunction);

    // Grant Lambda: KMS encrypt/decrypt
    props.tokenEncryptionKey.grantEncryptDecrypt(this.mcpFunction);

    // Grant Lambda: Secrets Manager read
    props.appleTeamIdSecret.grantRead(this.mcpFunction);
    props.appleKeyIdSecret.grantRead(this.mcpFunction);
    props.applePrivateKeySecret.grantRead(this.mcpFunction);

    // API Gateway HTTP API with Lambda integration
    const lambdaIntegration = new HttpLambdaIntegration(
      'McpLambdaIntegration',
      this.mcpFunction,
    );

    this.httpApi = new HttpApi(this, 'McpHttpApi', {
      apiName: `music-mcp-api-${props.environment}`,
      description: 'Music MCP Server HTTP API',
    });

    this.httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: lambdaIntegration,
    });
  }
}
