import { KMSClient, EncryptCommand } from '@aws-sdk/client-kms';

const REGION = process.env.REGION ?? 'us-east-1';
const KEY_ARN = process.env.TOKEN_ENCRYPTION_KEY_ARN ?? '';

const kmsClient = new KMSClient({ region: REGION });

export async function encryptToken(plaintext: string): Promise<string> {
  const command = new EncryptCommand({
    KeyId: KEY_ARN,
    Plaintext: Buffer.from(plaintext, 'utf-8'),
  });
  const data = await kmsClient.send(command);
  if (!data.CiphertextBlob) {
    throw new Error('KMS encryption did not return CiphertextBlob.');
  }
  return Buffer.from(data.CiphertextBlob).toString('base64');
}
