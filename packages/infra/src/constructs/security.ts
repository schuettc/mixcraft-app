import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface SecurityConstructProps {
  appleTeamIdParameterName: string;
  appleKeyIdParameterName: string;
  applePrivateKeyParameterName: string;
  clerkSecretKeyParameterName: string;
  clerkWebhookSecretParameterName: string;
  // Spotify parameters are optional — only looked up when enableSpotify is true.
  // Hosted deploys don't need these in Parameter Store.
  enableSpotify: boolean;
  spotifyClientIdParameterName: string;
  spotifyClientSecretParameterName: string;
}

export class SecurityConstruct extends Construct {
  public readonly tokenEncryptionKey: kms.Key;
  public readonly appleTeamIdParameter: ssm.IStringParameter;
  public readonly appleKeyIdParameter: ssm.IStringParameter;
  public readonly applePrivateKeyParameter: ssm.IStringParameter;
  public readonly clerkSecretKeyParameter: ssm.IStringParameter;
  public readonly clerkWebhookSecretParameter: ssm.IStringParameter;
  public readonly spotifyClientIdParameter: ssm.IStringParameter | undefined;
  public readonly spotifyClientSecretParameter: ssm.IStringParameter | undefined;

  constructor(scope: Construct, id: string, props: SecurityConstructProps) {
    super(scope, id);

    // KMS key for token encryption (symmetric, enable rotation)
    this.tokenEncryptionKey = new kms.Key(this, 'TokenEncryptionKey', {
      description: 'Encryption key for user music service tokens',
      enableKeyRotation: true,
    });

    // Parameter Store: look up existing SecureString parameters by name.
    // These hold third-party credentials that Secrets Manager could not rotate
    // anyway — rotation would mean logging into Apple's or Clerk's dashboard —
    // so SecureString gives the same KMS-encrypted, IAM-governed protection
    // without the per-secret monthly charge.
    this.appleTeamIdParameter = this.lookup(
      'AppleTeamIdParameter',
      props.appleTeamIdParameterName,
    );

    this.appleKeyIdParameter = this.lookup(
      'AppleKeyIdParameter',
      props.appleKeyIdParameterName,
    );

    this.applePrivateKeyParameter = this.lookup(
      'ApplePrivateKeyParameter',
      props.applePrivateKeyParameterName,
    );

    this.clerkSecretKeyParameter = this.lookup(
      'ClerkSecretKeyParameter',
      props.clerkSecretKeyParameterName,
    );

    this.clerkWebhookSecretParameter = this.lookup(
      'ClerkWebhookSecretParameter',
      props.clerkWebhookSecretParameterName,
    );

    if (props.enableSpotify) {
      this.spotifyClientIdParameter = this.lookup(
        'SpotifyClientIdParameter',
        props.spotifyClientIdParameterName,
      );

      this.spotifyClientSecretParameter = this.lookup(
        'SpotifyClientSecretParameter',
        props.spotifyClientSecretParameterName,
      );
    }
  }

  private lookup(id: string, parameterName: string): ssm.IStringParameter {
    return ssm.StringParameter.fromSecureStringParameterAttributes(this, id, {
      parameterName,
    });
  }

  /**
   * Grant a function permission to decrypt SecureString parameters.
   *
   * `IStringParameter.grantRead()` only grants the `ssm:*` actions. SecureString
   * values are encrypted under the account's AWS-managed `alias/aws/ssm` key, so
   * without `kms:Decrypt` every read fails at runtime with AccessDenied — after a
   * clean synth and a successful deploy. Callers must pair every `grantRead()`
   * with this.
   */
  public grantDecryptParameters(grantee: iam.IGrantable): void {
    const stack = cdk.Stack.of(this);
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        // KMS IAM policies cannot name a key by alias ARN — Resource must be a
        // key ARN or '*'. The account's `aws/ssm` key ARN is not knowable at
        // synth time, so scope with kms:ViaService instead: this permits decrypt
        // only for requests that arrive through Parameter Store, which is the
        // documented pattern and is narrower than it first looks.
        resources: ['*'],
        conditions: {
          StringEquals: {
            'kms:ViaService': `ssm.${stack.region}.amazonaws.com`,
          },
        },
      }),
    );
  }
}
