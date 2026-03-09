import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

const REGION = process.env.REGION ?? 'us-east-1';
const TABLE_NAME = process.env.USER_MUSIC_TOKENS_TABLE_NAME ?? '';
const KEY_ARN = process.env.TOKEN_ENCRYPTION_KEY_ARN ?? '';

const kmsClient = new KMSClient({ region: REGION });
const ddbDocClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
);

export interface UserTokens {
  developerToken: string;
  userToken: string;
}

export async function encryptToken(
  token: string,
  keyArn: string,
): Promise<string> {
  const command = new EncryptCommand({
    KeyId: keyArn,
    Plaintext: Buffer.from(token, 'utf-8'),
  });
  const data = await kmsClient.send(command);
  if (!data.CiphertextBlob) {
    throw new Error('KMS encryption did not return CiphertextBlob.');
  }
  return Buffer.from(data.CiphertextBlob).toString('base64');
}

export async function decryptToken(
  encryptedBase64: string,
  keyArn: string,
): Promise<string> {
  const command = new DecryptCommand({
    KeyId: keyArn,
    CiphertextBlob: Buffer.from(encryptedBase64, 'base64'),
  });
  const data = await kmsClient.send(command);
  if (!data.Plaintext) {
    throw new Error('KMS decryption did not return Plaintext.');
  }
  return Buffer.from(data.Plaintext).toString('utf-8');
}

export async function getUserTokens(
  userId: string,
  service: string,
): Promise<UserTokens | null> {
  const result = await ddbDocClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { userId, service },
    }),
  );

  if (!result.Item) {
    return null;
  }

  const encryptedToken = result.Item['encryptedToken'] as string;
  const decrypted = await decryptToken(encryptedToken, KEY_ARN);
  const tokens: UserTokens = JSON.parse(decrypted);
  return tokens;
}

export interface ConnectedService {
  connectedAt: string;
  userToken: string;
}

export async function getConnectedServices(
  userId: string,
): Promise<Map<string, ConnectedService>> {
  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );

  const services = new Map<string, ConnectedService>();

  if (!result.Items) {
    return services;
  }

  for (const item of result.Items) {
    const service = item['service'] as string;
    const encryptedToken = item['encryptedToken'] as string;
    const connectedAt = item['connectedAt'] as string;
    const decrypted = await decryptToken(encryptedToken, KEY_ARN);
    const tokens: UserTokens = JSON.parse(decrypted);
    services.set(service, { connectedAt, userToken: tokens.userToken });
  }

  return services;
}

export async function storeUserTokens(
  userId: string,
  service: string,
  token: string,
): Promise<void> {
  const encryptedToken = await encryptToken(token, KEY_ARN);
  const now = new Date().toISOString();

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        userId,
        service,
        encryptedToken,
        connectedAt: now,
        updatedAt: now,
      },
    }),
  );
}
