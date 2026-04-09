import { createClerkClient } from '@clerk/backend';
import { getSecret } from './secrets.js';
import type { SpotifyTokens } from './token-manager.js';

let cachedClerkClient: ReturnType<typeof createClerkClient> | null = null;

async function getClerkClient() {
  if (cachedClerkClient) return cachedClerkClient;
  const secretKey = await getSecret(process.env.CLERK_SECRET_KEY_NAME!);
  cachedClerkClient = createClerkClient({ secretKey });
  return cachedClerkClient;
}

/**
 * Fetch a fresh Spotify access token from Clerk for a given user.
 * Clerk manages refresh internally — this always returns a current token.
 * Returns null if the user has no Spotify connection in Clerk.
 */
export async function getSpotifyTokenFromClerk(
  userId: string,
): Promise<SpotifyTokens | null> {
  const client = await getClerkClient();

  try {
    const response = await client.users.getUserOauthAccessToken(userId, 'spotify');

    if (!response.data || response.data.length === 0) {
      return null;
    }

    const tokenData = response.data[0];
    return {
      kind: 'spotify',
      accessToken: tokenData.token,
      refreshToken: '',
      expiresAt: (tokenData as unknown as Record<string, unknown>).expiresAt as number
        ?? Date.now() + 3600_000,
    };
  } catch (err) {
    console.error('Failed to fetch Spotify token from Clerk:', err instanceof Error ? err.message : err);
    return null;
  }
}
