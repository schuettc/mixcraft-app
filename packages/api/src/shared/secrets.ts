import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const REGION = process.env.REGION ?? 'us-east-1';

const secretsManagerClient = new SecretsManagerClient({ region: REGION });

const secretsCache = new Map<string, string>();

export async function getSecret(secretName: string): Promise<string> {
  const cached = secretsCache.get(secretName);
  if (cached !== undefined) {
    return cached;
  }

  const data = await secretsManagerClient.send(
    new GetSecretValueCommand({ SecretId: secretName }),
  );

  let value: string;
  if (data.SecretString) {
    value = data.SecretString;
  } else if (data.SecretBinary) {
    value = Buffer.from(data.SecretBinary).toString('utf8');
  } else {
    throw new Error(`Secret value not found for ${secretName}`);
  }

  secretsCache.set(secretName, value);
  return value;
}
