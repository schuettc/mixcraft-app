import {
  PutCommand,
  DeleteCommand,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '../shared/dynamo.js';
import { encryptToken } from '../shared/kms.js';

const TOKENS_TABLE = process.env.USER_MUSIC_TOKENS_TABLE_NAME ?? '';

// Read at call time (not module load) so tests can toggle the env var.
function isSpotifyEnabled(): boolean {
  return process.env.ENABLE_SPOTIFY === 'true';
}

const VALID_PROVIDERS = ['apple_music', 'spotify'] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

function isValidProvider(provider: string): provider is Provider {
  return VALID_PROVIDERS.includes(provider as Provider);
}

function spotifyDisabledResponse(): { statusCode: number; body: string } {
  return {
    statusCode: 400,
    body: JSON.stringify({ error: 'Spotify is not enabled on this deployment' }),
  };
}

export function normalizeProvider(raw: string): string {
  // Accept hyphenated or underscored forms: apple-music -> apple_music
  return raw.replace(/-/g, '_');
}

export interface ConnectServiceOptions {
  expiresAt?: number;
  refreshToken?: string;
}

export async function connectService(
  userId: string,
  provider: string,
  token: string,
  options?: ConnectServiceOptions,
): Promise<{ statusCode: number; body: string }> {
  const normalized = normalizeProvider(provider);
  if (!isValidProvider(normalized)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Unsupported provider: ${provider}` }),
    };
  }
  if (normalized === 'spotify' && !isSpotifyEnabled()) {
    return spotifyDisabledResponse();
  }

  const tokenPayload = normalized === 'spotify'
    ? JSON.stringify({
        kind: 'spotify',
        accessToken: token,
        refreshToken: options?.refreshToken ?? '',
        expiresAt: options?.expiresAt ?? Date.now() + 3600_000,
      })
    : JSON.stringify({
        kind: 'apple_music',
        developerToken: '',
        userToken: token,
      });

  const encryptedToken = await encryptToken(tokenPayload);
  const now = new Date().toISOString();

  await ddbDocClient.send(
    new PutCommand({
      TableName: TOKENS_TABLE,
      Item: {
        userId,
        service: normalized,
        encryptedToken,
        connectedAt: now,
        updatedAt: now,
      },
    }),
  );

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
}

export async function disconnectService(
  userId: string,
  provider: string,
): Promise<{ statusCode: number; body: string }> {
  const normalized = normalizeProvider(provider);
  if (!isValidProvider(normalized)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Unsupported provider: ${provider}` }),
    };
  }
  if (normalized === 'spotify' && !isSpotifyEnabled()) {
    return spotifyDisabledResponse();
  }

  await ddbDocClient.send(
    new DeleteCommand({
      TableName: TOKENS_TABLE,
      Key: { userId, service: normalized },
    }),
  );

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
}

export async function getServiceStatus(
  userId: string,
  provider: string,
): Promise<{ statusCode: number; body: string }> {
  const normalized = normalizeProvider(provider);
  if (!isValidProvider(normalized)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Unsupported provider: ${provider}` }),
    };
  }
  if (normalized === 'spotify' && !isSpotifyEnabled()) {
    return {
      statusCode: 200,
      body: JSON.stringify({ connected: false }),
    };
  }

  const result = await ddbDocClient.send(
    new GetCommand({
      TableName: TOKENS_TABLE,
      Key: { userId, service: normalized },
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

export async function getAllServicesStatus(
  userId: string,
): Promise<{ statusCode: number; body: string }> {
  const result = await ddbDocClient.send(
    new QueryCommand({
      TableName: TOKENS_TABLE,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ProjectionExpression: 'service, connectedAt',
    }),
  );

  const services: Record<string, { connected: boolean; connectedAt: string }> = {};
  const spotifyEnabled = isSpotifyEnabled();

  // Always include all providers in the response shape so frontend code
  // can rely on `services.spotify` existing. Disabled deployments report
  // `connected: false` regardless of stored tokens — the portal then uses
  // its own enableSpotify config flag to decide whether to render the card.
  for (const provider of VALID_PROVIDERS) {
    services[provider] = { connected: false, connectedAt: '' };
  }

  if (result.Items) {
    for (const item of result.Items) {
      const service = item['service'] as string;
      if (!isValidProvider(service)) continue;
      // Disabled deployments must not report stale Spotify connections —
      // otherwise the portal's Step 1 indicator can show "complete" while
      // the MCP server exposes no Spotify tools.
      if (service === 'spotify' && !spotifyEnabled) continue;
      services[service] = {
        connected: true,
        connectedAt: item['connectedAt'] as string,
      };
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ services }),
  };
}
