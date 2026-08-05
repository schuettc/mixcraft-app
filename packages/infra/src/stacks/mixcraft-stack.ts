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
import { MonitoringConstruct } from '../constructs/monitoring.js';

export interface MixcraftStackProps extends StackProps {
  environment: string;
  domainName: string;
  clerkPublishableKey: string;
  enableSpotify: boolean;
  appleTeamIdParameterName: string;
  appleKeyIdParameterName: string;
  applePrivateKeyParameterName: string;
  clerkSecretKeyParameterName: string;
  clerkWebhookSecretParameterName: string;
  clerkOauthAuthorizeUrl: string;
  clerkOauthTokenUrl: string;
  spotifyClientIdParameterName: string;
  spotifyClientSecretParameterName: string;
  alertEmail: string;
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

    // Security: KMS key and Parameter Store references.
    // Note: CDK references pre-existing parameters for IAM grants only.
    // These SecureString parameters must exist before first deploy:
    //   - /mixcraft/{env}/apple-team-id
    //   - /mixcraft/{env}/apple-key-id
    //   - /mixcraft/{env}/apple-private-key
    //   - /mixcraft/{env}/clerk-secret-key
    //   - /mixcraft/{env}/clerk-webhook-secret
    const security = new SecurityConstruct(this, 'Security', {
      appleTeamIdParameterName: props.appleTeamIdParameterName,
      appleKeyIdParameterName: props.appleKeyIdParameterName,
      applePrivateKeyParameterName: props.applePrivateKeyParameterName,
      clerkSecretKeyParameterName: props.clerkSecretKeyParameterName,
      clerkWebhookSecretParameterName: props.clerkWebhookSecretParameterName,
      enableSpotify: props.enableSpotify,
      spotifyClientIdParameterName: props.spotifyClientIdParameterName,
      spotifyClientSecretParameterName: props.spotifyClientSecretParameterName,
    });

    // MCP API: Lambda + HTTP API Gateway with custom domain
    const mcpApi = new McpApiConstruct(this, 'McpApi', {
      usersTable: database.usersTable,
      apiKeysTable: database.apiKeysTable,
      userMusicTokensTable: database.userMusicTokensTable,
      sharedPlaylistsTable: database.sharedPlaylistsTable,
      tokenEncryptionKey: security.tokenEncryptionKey,
      appleTeamIdParameter: security.appleTeamIdParameter,
      appleKeyIdParameter: security.appleKeyIdParameter,
      applePrivateKeyParameter: security.applePrivateKeyParameter,
      clerkSecretKeyParameter: security.clerkSecretKeyParameter,
      grantDecryptParameters: (fn) => security.grantDecryptParameters(fn),
      enableSpotify: props.enableSpotify,
      spotifyClientIdParameter: security.spotifyClientIdParameter,
      spotifyClientSecretParameter: security.spotifyClientSecretParameter,
      portalUrl: `https://${props.domainName}`,
      clerkOauthAuthorizeUrl: props.clerkOauthAuthorizeUrl,
      clerkOauthTokenUrl: props.clerkOauthTokenUrl,
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
      enableSpotify: props.enableSpotify,
    });

    // Portal API: Lambda + HTTP API Gateway with custom domain
    // CORS origin set to portal custom domain
    const portalApi = new PortalApiConstruct(this, 'PortalApi', {
      usersTable: database.usersTable,
      apiKeysTable: database.apiKeysTable,
      userMusicTokensTable: database.userMusicTokensTable,
      sharedPlaylistsTable: database.sharedPlaylistsTable,
      tokenEncryptionKey: security.tokenEncryptionKey,
      appleTeamIdParameter: security.appleTeamIdParameter,
      appleKeyIdParameter: security.appleKeyIdParameter,
      applePrivateKeyParameter: security.applePrivateKeyParameter,
      clerkSecretKeyParameter: security.clerkSecretKeyParameter,
      clerkWebhookSecretParameter: security.clerkWebhookSecretParameter,
      grantDecryptParameters: (fn) => security.grantDecryptParameters(fn),
      enableSpotify: props.enableSpotify,
      spotifyClientIdParameter: security.spotifyClientIdParameter,
      spotifyClientSecretParameter: security.spotifyClientSecretParameter,
      portalUrl: portal.portalUrl,
      apiDomainName,
      hostedZone,
      certificate,
      environment: props.environment,
    });

    // Deploy portal content with runtime config.json
    portal.deployContent(
      portalApi.apiUrl,
      props.clerkPublishableKey,
      props.enableSpotify,
    );

    // Monitoring: alarms, SNS, CloudWatch dashboard
    new MonitoringConstruct(this, 'Monitoring', {
      environment: props.environment,
      alertEmail: props.alertEmail,
      mcpFunction: mcpApi.mcpFunction,
      portalApiFunction: portalApi.portalApiFunction,
      mcpApi: mcpApi.httpApi,
      portalApi: portalApi.httpApi,
      usersTable: database.usersTable,
      apiKeysTable: database.apiKeysTable,
      userMusicTokensTable: database.userMusicTokensTable,
    });

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
