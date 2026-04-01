import { getSecret } from './secrets.js';
import { getUserTokens, storeUserTokens, type SpotifyTokens } from './token-manager.js';

let cachedCredentials: { clientId: string; clientSecret: string } | null = null;

async function getSpotifyCredentials() {
  if (cachedCredentials) return cachedCredentials;
  const [clientId, clientSecret] = await Promise.all([
    getSecret(process.env.SPOTIFY_CLIENT_ID_SECRET_NAME!),
    getSecret(process.env.SPOTIFY_CLIENT_SECRET_SECRET_NAME!),
  ]);
  cachedCredentials = { clientId, clientSecret };
  return cachedCredentials;
}

/**
 * Refresh a Spotify access token using the stored refresh token
 * and Spotify client credentials (direct API call, no Clerk dependency).
 */
export async function refreshSpotifyToken(
  userId: string,
): Promise<SpotifyTokens | null> {
  const currentTokens = await getUserTokens(userId, 'spotify');
  if (!currentTokens || currentTokens.kind !== 'spotify') {
    console.error('No Spotify tokens found for user:', userId);
    return null;
  }

  if (!currentTokens.refreshToken) {
    console.error('No refresh token available for user:', userId);
    return null;
  }

  const { clientId, clientSecret } = await getSpotifyCredentials();

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: currentTokens.refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Spotify token refresh failed:', errorText);
    return null;
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const freshTokens: SpotifyTokens = {
    kind: 'spotify',
    accessToken: data.access_token,
    // Spotify may rotate the refresh token — always persist the latest
    refreshToken: data.refresh_token ?? currentTokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  await storeUserTokens(userId, 'spotify', freshTokens);

  return freshTokens;
}
