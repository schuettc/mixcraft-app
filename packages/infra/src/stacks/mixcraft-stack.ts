import { CfnOutput, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';
import { DatabaseConstruct } from '../constructs/database.js';
import { McpApiConstruct } from '../constructs/mcp-api.js';
import { PortalApiConstruct } from '../constructs/api.js';
import { PortalConstruct } from '../constructs/web.js';
import { SecurityConstruct } from '../constructs/security.js';

export interface MixcraftStackProps extends StackProps {
  environment: string;
  domainName: string;
  clerkPublishableKey: string;
  appleTeamIdSecretName: string;
  appleKeyIdSecretName: string;
  applePrivateKeySecretName: string;
  clerkSecretKeyName: string;
  clerkWebhookSecretName: string;
}

export class MixcraftStack extends Stack {
  constructor(scope: Construct, id: string, props: MixcraftStackProps) {
    super(scope, id, props);

    const apiDomainName = `api.${props.domainName}`;
    const mcpDomainName = `mcp.${props.domainName}`;

    // DNS: look up existing hosted zone
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.domainName,
    });

    // ACM certificate for apex + wildcard, DNS-validated
    const certificate = new certificatemanager.Certificate(
      this,
      'Certificate',
      {
        domainName: props.domainName,
        subjectAlternativeNames: [`*.${props.domainName}`],
        validation:
          certificatemanager.CertificateValidation.fromDns(hostedZone),
      },
    );

    // Database tables
    const database = new DatabaseConstruct(this, 'Database');

    // Security: KMS key and Secrets Manager references.
    // Note: CDK references pre-existing secrets for IAM grants only.
    // Secrets must be created in Secrets Manager before first deploy:
    //   - mixcraft/{env}/apple-team-id
    //   - mixcraft/{env}/apple-key-id
    //   - mixcraft/{env}/apple-private-key
    //   - mixcraft/{env}/clerk-secret-key
    //   - mixcraft/{env}/clerk-webhook-secret
    const security = new SecurityConstruct(this, 'Security', {
      appleTeamIdSecretName: props.appleTeamIdSecretName,
      appleKeyIdSecretName: props.appleKeyIdSecretName,
      applePrivateKeySecretName: props.applePrivateKeySecretName,
      clerkSecretKeyName: props.clerkSecretKeyName,
      clerkWebhookSecretName: props.clerkWebhookSecretName,
    });

    // MCP API: Lambda + HTTP API Gateway with custom domain
    const mcpApi = new McpApiConstruct(this, 'McpApi', {
      usersTable: database.usersTable,
      apiKeysTable: database.apiKeysTable,
      userMusicTokensTable: database.userMusicTokensTable,
      tokenEncryptionKey: security.tokenEncryptionKey,
      appleTeamIdSecret: security.appleTeamIdSecret,
      appleKeyIdSecret: security.appleKeyIdSecret,
      applePrivateKeySecret: security.applePrivateKeySecret,
      mcpDomainName,
      hostedZone,
      certificate,
      environment: props.environment,
    });

    // Portal: S3 + CloudFront with custom domain
    const portal = new PortalConstruct(this, 'Portal', {
      domainName: props.domainName,
      hostedZone,
      certificate,
      environment: props.environment,
    });

    // Portal API: Lambda + HTTP API Gateway with custom domain
    // CORS origin set to portal custom domain
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
      portalUrl: portal.portalUrl,
      apiDomainName,
      hostedZone,
      certificate,
      environment: props.environment,
    });

    // Deploy portal content with runtime config.json
    portal.deployContent(portalApi.apiUrl, props.clerkPublishableKey);

    // Outputs
    new CfnOutput(this, 'ApiUrl', {
      value: mcpApi.httpApi.url ?? '',
      description: 'MixCraft API URL',
    });

    new CfnOutput(this, 'PortalUrl', {
      value: portal.portalUrl,
      description: 'Portal URL',
    });

    new CfnOutput(this, 'PortalApiUrl', {
      value: portalApi.apiUrl,
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
