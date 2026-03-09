import { CfnOutput, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { DatabaseConstruct } from '../constructs/database.js';
import { McpApiConstruct } from '../constructs/mcp-api.js';
import { PortalApiConstruct } from '../constructs/portal-api.js';
import { PortalConstruct } from '../constructs/portal.js';
import { SecurityConstruct } from '../constructs/security.js';

export interface MusicMcpStackProps extends StackProps {
  environment: string;
  appleTeamIdSecretName: string;
  appleKeyIdSecretName: string;
  applePrivateKeySecretName: string;
  clerkSecretKeyName: string;
  clerkWebhookSecretName: string;
}

export class MusicMcpStack extends Stack {
  constructor(scope: Construct, id: string, props: MusicMcpStackProps) {
    super(scope, id, props);

    // Database tables
    const database = new DatabaseConstruct(this, 'Database');

    // Security: KMS key and Secrets Manager references
    const security = new SecurityConstruct(this, 'Security', {
      appleTeamIdSecretName: props.appleTeamIdSecretName,
      appleKeyIdSecretName: props.appleKeyIdSecretName,
      applePrivateKeySecretName: props.applePrivateKeySecretName,
      clerkSecretKeyName: props.clerkSecretKeyName,
      clerkWebhookSecretName: props.clerkWebhookSecretName,
    });

    // MCP API: Lambda + HTTP API Gateway
    const mcpApi = new McpApiConstruct(this, 'McpApi', {
      usersTable: database.usersTable,
      apiKeysTable: database.apiKeysTable,
      userMusicTokensTable: database.userMusicTokensTable,
      tokenEncryptionKey: security.tokenEncryptionKey,
      appleTeamIdSecret: security.appleTeamIdSecret,
      appleKeyIdSecret: security.appleKeyIdSecret,
      applePrivateKeySecret: security.applePrivateKeySecret,
      environment: props.environment,
    });

    // Portal API: Lambda + HTTP API Gateway for portal backend
    // Note: portalUrl uses '*' initially; after first deploy, update CORS
    // with the actual CloudFront domain if desired.
    const portalApi = new PortalApiConstruct(this, 'PortalApi', {
      usersTable: database.usersTable,
      apiKeysTable: database.apiKeysTable,
      userMusicTokensTable: database.userMusicTokensTable,
      tokenEncryptionKey: security.tokenEncryptionKey,
      appleTeamIdSecret: security.appleTeamIdSecret,
      appleKeyIdSecret: security.appleKeyIdSecret,
      applePrivateKeySecret: security.applePrivateKeySecret,
      clerkSecretKey: security.clerkSecretKey,
      clerkWebhookSecret: security.clerkWebhookSecret,
      portalUrl: '*',
      environment: props.environment,
    });

    // Portal: S3 + CloudFront for React SPA
    const portal = new PortalConstruct(this, 'Portal', {
      portalApiUrl: portalApi.httpApi.url ?? '',
      environment: props.environment,
    });

    // Outputs
    new CfnOutput(this, 'ApiUrl', {
      value: mcpApi.httpApi.url ?? '',
      description: 'Music MCP API URL',
    });

    new CfnOutput(this, 'PortalUrl', {
      value: portal.portalUrl,
      description: 'Portal CloudFront URL',
    });

    new CfnOutput(this, 'PortalApiUrl', {
      value: portalApi.httpApi.url ?? '',
      description: 'Portal API URL',
    });

    new CfnOutput(this, 'UsersTableName', {
      value: database.usersTable.tableName,
      description: 'Users DynamoDB table name',
    });

    new CfnOutput(this, 'ApiKeysTableName', {
      value: database.apiKeysTable.tableName,
      description: 'API Keys DynamoDB table name',
    });

    new CfnOutput(this, 'UserMusicTokensTableName', {
      value: database.userMusicTokensTable.tableName,
      description: 'User Music Tokens DynamoDB table name',
    });

    new CfnOutput(this, 'TokenEncryptionKeyArn', {
      value: security.tokenEncryptionKey.keyArn,
      description: 'KMS Key ARN for token encryption',
    });
  }
}
