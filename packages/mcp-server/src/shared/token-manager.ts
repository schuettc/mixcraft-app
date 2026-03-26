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

export interface AppleMusicTokens {
  kind: 'apple_music';
  developerToken: string;
  userToken: string;
}

export interface SpotifyTokens {
  kind: 'spotify';
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type ServiceTokens = AppleMusicTokens | SpotifyTokens;

// Keep backward compat alias
export type UserTokens = AppleMusicTokens;

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
): Promise<ServiceTokens | null> {
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
  const parsed = JSON.parse(decrypted);

  // Migration: rows without `kind` use the service key to determine type
  if (!parsed.kind) {
    if (service === 'spotify') {
      return {
        kind: 'spotify',
        accessToken: parsed.userToken ?? '',
        refreshToken: '',
        expiresAt: Date.now() + 3600_000,
      };
    }
    return { kind: 'apple_music', ...parsed } as AppleMusicTokens;
  }

  return parsed as ServiceTokens;
}

export interface ConnectedService {
  connectedAt: string;
  tokens: ServiceTokens;
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
    const parsed = JSON.parse(decrypted);

    // Migration: rows without `kind` use the DynamoDB sort key to determine type
    let parsedTokens: ServiceTokens;
    if (parsed.kind) {
      parsedTokens = parsed as ServiceTokens;
    } else if (service === 'spotify') {
      // Legacy Spotify rows stored as { developerToken: '', userToken: token }
      parsedTokens = {
        kind: 'spotify',
        accessToken: parsed.userToken ?? '',
        refreshToken: '',
        expiresAt: Date.now() + 3600_000,
      };
    } else {
      parsedTokens = { kind: 'apple_music', ...parsed } as AppleMusicTokens;
    }

    services.set(service, { connectedAt, tokens: parsedTokens });
  }

  return services;
}

export async function storeUserTokens(
  userId: string,
  service: string,
  tokens: ServiceTokens,
): Promise<void> {
  const encryptedToken = await encryptToken(JSON.stringify(tokens), KEY_ARN);
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
