import { CfnOutput, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { DatabaseConstruct } from '../constructs/database.js';
import { McpApiConstruct } from '../constructs/mcp-api.js';
import { SecurityConstruct } from '../constructs/security.js';

export interface MusicMcpStackProps extends StackProps {
  environment: string;
  appleTeamIdSecretName: string;
  appleKeyIdSecretName: string;
  applePrivateKeySecretName: string;
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

    // Outputs
    new CfnOutput(this, 'ApiUrl', {
      value: mcpApi.httpApi.url ?? '',
      description: 'Music MCP API URL',
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

    new CfnOutput(this, 'KmsKeyArn', {
      value: security.tokenEncryptionKey.keyArn,
      description: 'KMS Key ARN for token encryption',
    });
  }
}
