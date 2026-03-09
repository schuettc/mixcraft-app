import { createHash, randomBytes } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { AuthenticationError } from '../shared/errors.js';

const API_KEY_PREFIX = 'mx_';

export interface ApiKeyRecord {
  userId: string;
  keyPrefix: string;
  name: string;
}

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.REGION ?? 'us-east-1' }),
);

const tableName = (): string => {
  const name = process.env.API_KEYS_TABLE_NAME;
  if (!name) {
    throw new Error('API_KEYS_TABLE_NAME environment variable is not set');
  }
  return name;
};

/**
 * Compute a SHA-256 hex digest of the given string.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Validate an API key: verify prefix, look up hash in DynamoDB,
 * check active status, update lastUsedAt, and return the record.
 */
export async function validateApiKey(apiKey: string): Promise<ApiKeyRecord> {
  if (!apiKey.startsWith(API_KEY_PREFIX)) {
    throw new AuthenticationError('Invalid API key format');
  }

  const keyHash = hashApiKey(apiKey);

  const result = await client.send(
    new GetCommand({
      TableName: tableName(),
      Key: { keyHash },
    }),
  );

  if (!result.Item) {
    throw new AuthenticationError('Invalid API key');
  }

  if (result.Item.isActive !== true) {
    throw new AuthenticationError('API key is inactive');
  }

  // Update lastUsedAt timestamp (fire-and-forget to avoid blocking the request)
  client.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { keyHash },
      UpdateExpression: 'SET lastUsedAt = :now',
      ExpressionAttributeValues: {
        ':now': new Date().toISOString(),
      },
    }),
  ).catch(() => { /* non-critical */ });

  return {
    userId: result.Item.userId as string,
    keyPrefix: result.Item.keyPrefix as string,
    name: result.Item.name as string,
  };
}

/**
 * Generate a new API key. Returns the raw key (shown once to the user)
 * and its SHA-256 hash (stored in DynamoDB).
 */
export function generateApiKey(): { rawKey: string; keyHash: string } {
  const randomPart = randomBytes(16).toString('hex');
  const rawKey = `${API_KEY_PREFIX}${randomPart}`;
  const keyHash = hashApiKey(rawKey);
  return { rawKey, keyHash };
}
