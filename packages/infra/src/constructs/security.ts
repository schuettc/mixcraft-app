import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface SecurityConstructProps {
  appleTeamIdSecretName: string;
  appleKeyIdSecretName: string;
  applePrivateKeySecretName: string;
  clerkSecretKeyName: string;
  clerkWebhookSecretName: string;
}

export class SecurityConstruct extends Construct {
  public readonly tokenEncryptionKey: kms.Key;
  public readonly appleTeamIdSecret: secretsmanager.ISecret;
  public readonly appleKeyIdSecret: secretsmanager.ISecret;
  public readonly applePrivateKeySecret: secretsmanager.ISecret;
  public readonly clerkSecretKey: secretsmanager.ISecret;
  public readonly clerkWebhookSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: SecurityConstructProps) {
    super(scope, id);

    // KMS key for token encryption (symmetric, enable rotation)
    this.tokenEncryptionKey = new kms.Key(this, 'TokenEncryptionKey', {
      description: 'Encryption key for user music service tokens',
      enableKeyRotation: true,
    });

    // Secrets Manager: lookup existing secrets by name
    this.appleTeamIdSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'AppleTeamIdSecret',
      props.appleTeamIdSecretName,
    );

    this.appleKeyIdSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'AppleKeyIdSecret',
      props.appleKeyIdSecretName,
    );

    this.applePrivateKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'ApplePrivateKeySecret',
      props.applePrivateKeySecretName,
    );

    this.clerkSecretKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      'ClerkSecretKey',
      props.clerkSecretKeyName,
    );

    this.clerkWebhookSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'ClerkWebhookSecret',
      props.clerkWebhookSecretName,
    );
  }
}
