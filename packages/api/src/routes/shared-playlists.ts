import crypto from 'node:crypto';
import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '../shared/dynamo.js';

const TABLE = process.env.SHARED_PLAYLISTS_TABLE_NAME ?? '';
const MAX_SHARES_PER_USER = 50;
const MAX_TRACKS = 500;
const MAX_SUMMARY_LENGTH = 5000;
const MAX_TITLE_LENGTH = 200;

interface TrackRecord {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}

interface CreateShareInput {
  title: string;
  service: string;
  playlistExternalId?: string;
  tracks: TrackRecord[];
  conversationSummary?: string;
}

function generateShareId(): string {
  // 21 URL-safe characters, ~126 bits of entropy
  const bytes = crypto.randomBytes(16);
  return bytes.toString('base64url').slice(0, 21);
}

export async function createSharedPlaylist(
  userId: string,
  input: CreateShareInput,
): Promise<{ statusCode: number; body: string }> {
  if (!input.title || input.title.length > MAX_TITLE_LENGTH) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Title is required and must be under ${MAX_TITLE_LENGTH} characters` }),
    };
  }

  if (!['apple_music', 'spotify'].includes(input.service)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Service must be apple_music or spotify' }),
    };
  }

  if (!input.tracks || input.tracks.length === 0 || input.tracks.length > MAX_TRACKS) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Tracks array must have 1-${MAX_TRACKS} items` }),
    };
  }

  if (input.conversationSummary && input.conversationSummary.length > MAX_SUMMARY_LENGTH) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Conversation summary must be under ${MAX_SUMMARY_LENGTH} characters` }),
    };
  }

  // Check share limit per user
  const existing = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'UserIdCreatedAtIndex',
      KeyConditionExpression: 'userId = :uid',
      FilterExpression: 'attribute_not_exists(isDeleted) OR isDeleted = :false',
      ExpressionAttributeValues: { ':uid': userId, ':false': false },
      Select: 'COUNT',
    }),
  );

  if ((existing.Count ?? 0) >= MAX_SHARES_PER_USER) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Maximum ${MAX_SHARES_PER_USER} shared playlists allowed` }),
    };
  }

  const shareId = generateShareId();
  const now = new Date().toISOString();

  await ddbDocClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        shareId,
        userId,
        title: input.title,
        service: input.service,
        playlistExternalId: input.playlistExternalId ?? null,
        tracks: input.tracks,
        trackCount: input.tracks.length,
        conversationSummary: input.conversationSummary ?? null,
        createdAt: now,
      },
    }),
  );

  return {
    statusCode: 201,
    body: JSON.stringify({
      shareId,
      shareUrl: `https://mixcraft.app/share/${shareId}`,
      createdAt: now,
    }),
  };
}

export async function getSharedPlaylist(
  shareId: string,
): Promise<{ statusCode: number; body: string }> {
  const result = await ddbDocClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { shareId },
    }),
  );

  if (!result.Item || result.Item['isDeleted'] === true) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Not found' }),
    };
  }

  const item = result.Item;

  // Public response — never include userId
  return {
    statusCode: 200,
    body: JSON.stringify({
      shareId: item['shareId'],
      title: item['title'],
      service: item['service'],
      playlistExternalId: item['playlistExternalId'] ?? null,
      trackCount: item['trackCount'],
      tracks: item['tracks'],
      conversationSummary: item['conversationSummary'] ?? null,
      userMessages: item['userMessages'] ?? [],
      assistantMessages: item['assistantMessages'] ?? [],
      createdAt: item['createdAt'],
    }),
  };
}

export async function listSharedPlaylists(
  userId: string,
): Promise<{ statusCode: number; body: string }> {
  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'UserIdCreatedAtIndex',
      KeyConditionExpression: 'userId = :uid',
      FilterExpression: 'attribute_not_exists(isDeleted) OR isDeleted = :false',
      ExpressionAttributeValues: { ':uid': userId, ':false': false },
      ScanIndexForward: false, // newest first
    }),
  );

  const items = (result.Items ?? []).map((item) => ({
    shareId: item['shareId'] as string,
    shareUrl: `https://mixcraft.app/share/${item['shareId']}`,
    title: item['title'] as string,
    service: item['service'] as string,
    trackCount: item['trackCount'] as number,
    createdAt: item['createdAt'] as string,
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({ items }),
  };
}

export async function deleteSharedPlaylist(
  userId: string,
  shareId: string,
): Promise<{ statusCode: number; body: string }> {
  // Fetch to verify ownership
  const result = await ddbDocClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { shareId },
    }),
  );

  if (!result.Item || result.Item['isDeleted'] === true) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Not found' }),
    };
  }

  if (result.Item['userId'] !== userId) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  await ddbDocClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { shareId },
      UpdateExpression: 'SET isDeleted = :true',
      ExpressionAttributeValues: { ':true': true },
    }),
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
}
