import crypto from 'crypto';
import { getSecret } from '../shared/secrets.js';
import { connectService } from './services.js';

const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-top-read',
  'user-read-recently-played',
].join(' ');

/** HMAC key derived from Spotify client secret for state signing. */
let cachedHmacKey: string | null = null;

async function getSpotifyCredentials() {
  const [clientId, clientSecret] = await Promise.all([
    getSecret(process.env.SPOTIFY_CLIENT_ID_SECRET_NAME!),
    getSecret(process.env.SPOTIFY_CLIENT_SECRET_SECRET_NAME!),
  ]);
  return { clientId, clientSecret };
}

/** Create HMAC-signed state: userId + timestamp, verifiable without storage. */
function createState(userId: string, hmacKey: string): string {
  const timestamp = Date.now().toString();
  const payload = `${userId}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');
  // base64url encode: payload.hmac
  return Buffer.from(`${payload}.${hmac}`).toString('base64url');
}

/** Verify and extract userId from state. Returns null if invalid or expired (10min). */
function verifyState(state: string, hmacKey: string): string | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString();
    const dotIndex = decoded.lastIndexOf('.');
    if (dotIndex === -1) return null;

    const payload = decoded.slice(0, dotIndex);
    const providedHmac = decoded.slice(dotIndex + 1);

    const expectedHmac = crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(providedHmac), Buffer.from(expectedHmac))) {
      return null;
    }

    const [userId, timestamp] = payload.split(':');
    const age = Date.now() - Number(timestamp);
    if (age > 10 * 60 * 1000) return null; // expired after 10 minutes

    return userId;
  } catch {
    return null;
  }
}

export async function getSpotifyAuthUrl(
  userId: string,
): Promise<{ statusCode: number; body: string }> {
  const { clientId, clientSecret } = await getSpotifyCredentials();
  cachedHmacKey = clientSecret;

  const redirectUri = `${process.env.API_BASE_URL}/api/spotify/callback`;
  const state = createState(userId, clientSecret);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES,
    state,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ url: `https://accounts.spotify.com/authorize?${params}` }),
  };
}

export async function handleSpotifyCallback(
  code: string,
  state: string,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const { clientId, clientSecret } = await getSpotifyCredentials();

  const userId = verifyState(state, clientSecret);
  if (!userId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: '<html><body><h2>Invalid or expired authorization. Please try again.</h2></body></html>',
    };
  }

  const redirectUri = `${process.env.API_BASE_URL}/api/spotify/callback`;

  // Exchange authorization code for tokens
  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('Spotify token exchange failed:', errorText);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: '<html><body><h2>Failed to connect Spotify. Please try again.</h2></body></html>',
    };
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  // Store tokens via existing connectService
  await connectService(userId, 'spotify', tokenData.access_token, {
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
  });

  const portalUrl = process.env.PORTAL_URL || 'https://mixcraft.app';

  // Return HTML that notifies the parent window and closes
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!DOCTYPE html>
<html><body>
<p>Spotify connected! This window will close automatically.</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'spotify-connected' }, '${portalUrl}');
  }
  window.close();
</script>
</body></html>`,
  };
}
