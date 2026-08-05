import { Duration } from 'aws-cdk-lib';
import {
  CfnStage,
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
import type * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface PortalApiConstructProps {
  usersTable: Table;
  apiKeysTable: Table;
  userMusicTokensTable: Table;
  sharedPlaylistsTable: Table;
  tokenEncryptionKey: kms.Key;
  appleTeamIdParameter: ssm.IStringParameter;
  appleKeyIdParameter: ssm.IStringParameter;
  applePrivateKeyParameter: ssm.IStringParameter;
  clerkSecretKeyParameter: ssm.IStringParameter;
  clerkWebhookSecretParameter: ssm.IStringParameter;
  grantDecryptParameters: (grantee: NodejsFunction) => void;
  enableSpotify: boolean;
  spotifyClientIdParameter: ssm.IStringParameter | undefined;
  spotifyClientSecretParameter: ssm.IStringParameter | undefined;
  portalUrl: string;
  apiDomainName: string;
  hostedZone: route53.IHostedZone;
  certificate: certificatemanager.ICertificate;
  environment: string;
}

export class PortalApiConstruct extends Construct {
  public readonly httpApi: HttpApi;
  public readonly apiUrl: string;
  public readonly portalApiFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: PortalApiConstructProps) {
    super(scope, id);

    this.portalApiFunction = new NodejsFunction(this, 'PortalApiFunction', {
      entry: path.join(
        __dirname,
        '..',
        '..',
        '..',
        'api',
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
        APPLE_TEAM_ID_PARAMETER_NAME: props.appleTeamIdParameter.parameterName,
        APPLE_KEY_ID_PARAMETER_NAME: props.appleKeyIdParameter.parameterName,
        APPLE_PRIVATE_KEY_PARAMETER_NAME:
          props.applePrivateKeyParameter.parameterName,
        CLERK_SECRET_KEY_PARAMETER_NAME:
          props.clerkSecretKeyParameter.parameterName,
        CLERK_WEBHOOK_SECRET_PARAMETER_NAME:
          props.clerkWebhookSecretParameter.parameterName,
        ENABLE_SPOTIFY: String(props.enableSpotify),
        ...(props.enableSpotify && props.spotifyClientIdParameter
          ? {
              SPOTIFY_CLIENT_ID_PARAMETER_NAME:
                props.spotifyClientIdParameter.parameterName,
            }
          : {}),
        ...(props.enableSpotify && props.spotifyClientSecretParameter
          ? {
              SPOTIFY_CLIENT_SECRET_PARAMETER_NAME:
                props.spotifyClientSecretParameter.parameterName,
            }
          : {}),
        SHARED_PLAYLISTS_TABLE_NAME: props.sharedPlaylistsTable.tableName,
        PORTAL_URL: props.portalUrl,
        API_BASE_URL: `https://${props.apiDomainName}`,
        REGION: process.env.CDK_DEFAULT_REGION || 'us-east-1',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
      },
    });

    // Grants
    props.usersTable.grantReadWriteData(this.portalApiFunction);
    props.apiKeysTable.grantReadWriteData(this.portalApiFunction);
    props.userMusicTokensTable.grantReadWriteData(this.portalApiFunction);
    props.sharedPlaylistsTable.grantReadWriteData(this.portalApiFunction);
    props.tokenEncryptionKey.grantEncryptDecrypt(this.portalApiFunction);
    props.appleTeamIdParameter.grantRead(this.portalApiFunction);
    props.appleKeyIdParameter.grantRead(this.portalApiFunction);
    props.applePrivateKeyParameter.grantRead(this.portalApiFunction);
    props.clerkSecretKeyParameter.grantRead(this.portalApiFunction);
    props.clerkWebhookSecretParameter.grantRead(this.portalApiFunction);
    if (props.enableSpotify) {
      props.spotifyClientIdParameter?.grantRead(this.portalApiFunction);
      props.spotifyClientSecretParameter?.grantRead(this.portalApiFunction);
    }
    // grantRead() covers ssm:GetParameter only; SecureString also needs KMS.
    props.grantDecryptParameters(this.portalApiFunction);

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
        this.portalApiFunction,
      ),
    });

    // Throttle: 20 requests/second sustained, burst to 50
    const defaultStage = this.httpApi.defaultStage!.node.defaultChild as CfnStage;
    defaultStage.defaultRouteSettings = {
      throttlingBurstLimit: 50,
      throttlingRateLimit: 20,
    };

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
