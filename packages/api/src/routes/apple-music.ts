import {
  PutCommand,
  DeleteCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '../shared/dynamo.js';
import { encryptToken } from '../shared/kms.js';

const TOKENS_TABLE = process.env.USER_MUSIC_TOKENS_TABLE_NAME ?? '';

export async function connectAppleMusic(
  userId: string,
  musicUserToken: string,
): Promise<{ statusCode: number; body: string }> {
  const tokenPayload = JSON.stringify({
    developerToken: '',
    userToken: musicUserToken,
  });

  const encryptedToken = await encryptToken(tokenPayload);
  const now = new Date().toISOString();

  await ddbDocClient.send(
    new PutCommand({
      TableName: TOKENS_TABLE,
      Item: {
        userId,
        service: 'apple_music',
        encryptedToken,
        connectedAt: now,
        updatedAt: now,
      },
    }),
  );

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
}

export async function disconnectAppleMusic(
  userId: string,
): Promise<{ statusCode: number; body: string }> {
  await ddbDocClient.send(
    new DeleteCommand({
      TableName: TOKENS_TABLE,
      Key: { userId, service: 'apple_music' },
    }),
  );

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
}

export async function getAppleMusicStatus(
  userId: string,
): Promise<{ statusCode: number; body: string }> {
  const result = await ddbDocClient.send(
    new GetCommand({
      TableName: TOKENS_TABLE,
      Key: { userId, service: 'apple_music' },
    }),
  );

  if (result.Item) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        connected: true,
        connectedAt: result.Item['connectedAt'] as string,
      }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ connected: false }),
  };
}
