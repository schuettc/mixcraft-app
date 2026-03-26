import { createClerkClient } from '@clerk/backend';
import { getSecret } from './secrets.js';
import { storeUserTokens, type SpotifyTokens } from './token-manager.js';

let cachedClerkClient: ReturnType<typeof createClerkClient> | null = null;

async function getClerkClient() {
  if (cachedClerkClient) return cachedClerkClient;
  const secretName = process.env.CLERK_SECRET_KEY_NAME;
  if (!secretName) {
    throw new Error('CLERK_SECRET_KEY_NAME not configured');
  }
  const secretKey = await getSecret(secretName);
  cachedClerkClient = createClerkClient({ secretKey });
  return cachedClerkClient;
}

/**
 * Refresh a Spotify access token via Clerk's backend SDK.
 * Clerk handles the OAuth refresh internally and returns a fresh token.
 * The new token is stored in DynamoDB and returned.
 */
export async function refreshSpotifyToken(
  userId: string,
): Promise<SpotifyTokens | null> {
  const client = await getClerkClient();
  const response = await client.users.getUserOauthAccessToken(
    userId,
    'spotify',
  );

  if (!response.data || response.data.length === 0) {
    console.error('Clerk returned no Spotify token for user:', userId);
    return null;
  }

  const tokenData = response.data[0];
  const freshTokens: SpotifyTokens = {
    kind: 'spotify',
    accessToken: tokenData.token,
    refreshToken: '',
    expiresAt: Date.now() + 3600_000, // 1 hour from now
  };

  // Persist the refreshed token
  await storeUserTokens(userId, 'spotify', freshTokens);

  return freshTokens;
}
