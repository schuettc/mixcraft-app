import crypto from 'node:crypto';
import {
  QueryCommand,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '../shared/dynamo.js';

const API_KEYS_TABLE = process.env.API_KEYS_TABLE_NAME ?? '';

export async function listApiKeys(
  userId: string,
): Promise<{ statusCode: number; body: string }> {
  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: API_KEYS_TABLE,
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ScanIndexForward: false,
    }),
  );

  const keys = (result.Items ?? []).map((item) => ({
    keyHash: item['keyHash'] as string,
    keyPrefix: item['keyPrefix'] as string,
    name: item['name'] as string,
    createdAt: item['createdAt'] as string,
    lastUsedAt: item['lastUsedAt'] as string | undefined,
    isActive: item['isActive'] as boolean,
  }));

  return { statusCode: 200, body: JSON.stringify(keys) };
}

export async function createApiKey(
  userId: string,
  name: string,
): Promise<{ statusCode: number; body: string }> {
  const rawKey = 'mmc_' + crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 8);
  const createdAt = new Date().toISOString();

  await ddbDocClient.send(
    new PutCommand({
      TableName: API_KEYS_TABLE,
      Item: {
        keyHash,
        userId,
        keyPrefix,
        name,
        createdAt,
        lastUsedAt: null,
        isActive: true,
      },
    }),
  );

  return {
    statusCode: 201,
    body: JSON.stringify({ rawKey, keyPrefix, name, createdAt }),
  };
}

export async function deactivateApiKey(
  userId: string,
  keyHash: string,
): Promise<{ statusCode: number; body: string }> {
  // Verify ownership
  const existing = await ddbDocClient.send(
    new GetCommand({
      TableName: API_KEYS_TABLE,
      Key: { keyHash },
    }),
  );

  if (!existing.Item) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Key not found' }) };
  }

  if (existing.Item['userId'] !== userId) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  await ddbDocClient.send(
    new UpdateCommand({
      TableName: API_KEYS_TABLE,
      Key: { keyHash },
      UpdateExpression: 'SET isActive = :inactive',
      ExpressionAttributeValues: { ':inactive': false },
    }),
  );

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
}
