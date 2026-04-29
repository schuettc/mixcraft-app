import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { validateClerkSession } from './shared/clerk.js';
import { handleWebhook } from './routes/auth.js';
import { listApiKeys, createApiKey, deactivateApiKey, deleteApiKey } from './routes/api-keys.js';
import {
  connectAppleMusic,
  disconnectAppleMusic,
  getAppleMusicStatus,
} from './routes/apple-music.js';
import { getDeveloperToken } from './routes/developer-token.js';
import {
  connectService,
  disconnectService,
  getServiceStatus,
  getAllServicesStatus,
  normalizeProvider,
} from './routes/services.js';
import { syncFromClerk } from './routes/sync-from-clerk.js';
import { getSpotifyAuthUrl, handleSpotifyCallback } from './routes/spotify-oauth.js';
import {
  createSharedPlaylist,
  getSharedPlaylist,
  listSharedPlaylists,
  deleteSharedPlaylist,
} from './routes/shared-playlists.js';

const ENABLE_SPOTIFY = process.env.ENABLE_SPOTIFY === 'true';

function parseRequest(event: APIGatewayProxyEventV2): {
  method: string;
  path: string;
} {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  return { method, path };
}

function jsonResponse(
  statusCode: number,
  body: unknown,
  corsHeaders: Record<string, string>,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const { method, path } = parseRequest(event);

  const corsHeaders = {
    'Access-Control-Allow-Origin': process.env.PORTAL_URL || 'https://mixcraft.app',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };

  // Handle OPTIONS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Reject non-API paths early so scanner traffic (/.env, /phpinfo.php, etc.)
  // doesn't trip auth-failure logging or alarms
  if (!path.startsWith('/api/')) {
    return jsonResponse(404, { error: 'Not found' }, corsHeaders);
  }

  try {
    // Webhook route (no auth required)
    if (path === '/api/auth/webhook' && method === 'POST') {
      const result = await handleWebhook(event);
      return { ...result, headers: corsHeaders };
    }

    // Shared playlist public view (no auth required)
    if (path.startsWith('/api/shared-playlists/') && method === 'GET') {
      const shareId = path.split('/api/shared-playlists/')[1];
      if (shareId) {
        const result = await getSharedPlaylist(shareId);
        return jsonResponse(result.statusCode, result.body, corsHeaders);
      }
    }

    // Spotify OAuth callback (no auth — redirect from Spotify).
    // Disabled deployments 404 instead of leaking the route's existence.
    if (ENABLE_SPOTIFY && path === '/api/spotify/callback' && method === 'GET') {
      const code = event.queryStringParameters?.['code'];
      const state = event.queryStringParameters?.['state'];
      if (!code || !state) {
        return jsonResponse(400, { error: 'Missing code or state' }, corsHeaders);
      }
      const result = await handleSpotifyCallback(code, state);
      return { statusCode: result.statusCode, headers: result.headers, body: result.body };
    }

    // All other routes require Clerk session
    const session = await validateClerkSession(
      event.headers['authorization'] ?? event.headers['Authorization'],
    );
    const { userId } = session;

    // API Keys routes
    if (path === '/api/keys' && method === 'GET') {
      const result = await listApiKeys(userId);
      return { ...result, headers: { 'Content-Type': 'application/json', ...corsHeaders } };
    }

    if (path === '/api/keys' && method === 'POST') {
      const body = JSON.parse(event.body ?? '{}') as { name?: string };
      const result = await createApiKey(userId, body.name ?? 'Unnamed Key');
      return { ...result, headers: { 'Content-Type': 'application/json', ...corsHeaders } };
    }

    if (path.startsWith('/api/keys/') && method === 'DELETE') {
      const keyHash = path.split('/api/keys/')[1];
      if (!keyHash) {
        return jsonResponse(400, { error: 'Missing keyHash' }, corsHeaders);
      }
      const result = await deleteApiKey(userId, decodeURIComponent(keyHash));
      return { ...result, headers: { 'Content-Type': 'application/json', ...corsHeaders } };
    }

    // Apple Music routes
    if (path === '/api/apple-music/connect' && method === 'POST') {
      const body = JSON.parse(event.body ?? '{}') as { musicUserToken?: string };
      if (!body.musicUserToken) {
        return jsonResponse(400, { error: 'Missing musicUserToken' }, corsHeaders);
      }
      const result = await connectAppleMusic(userId, body.musicUserToken);
      return { ...result, headers: { 'Content-Type': 'application/json', ...corsHeaders } };
    }

    if (path === '/api/apple-music/disconnect' && method === 'POST') {
      const result = await disconnectAppleMusic(userId);
      return { ...result, headers: { 'Content-Type': 'application/json', ...corsHeaders } };
    }

    if (path === '/api/apple-music/status' && method === 'GET') {
      const result = await getAppleMusicStatus(userId);
      return { ...result, headers: { 'Content-Type': 'application/json', ...corsHeaders } };
    }

    if (path === '/api/apple-music/developer-token' && method === 'GET') {
      const result = await getDeveloperToken();
      return { ...result, headers: { 'Content-Type': 'application/json', ...corsHeaders } };
    }

    // Generalized service routes
    const serviceMatch = path.match(/^\/api\/services\/([^/]+)\/(connect|disconnect|status)$/);
    if (serviceMatch) {
      const [, provider, action] = serviceMatch;
      if (action === 'connect' && method === 'POST') {
        const body = JSON.parse(event.body ?? '{}') as { token?: string };
        if (!body.token) {
          return jsonResponse(400, { error: 'Missing token' }, corsHeaders);
        }
        const result = await connectService(userId, provider, body.token);
        return { ...result, headers: { 'Content-Type': 'application/json', ...corsHeaders } };
      }
      if (action === 'disconnect' && method === 'POST') {
        const result = await disconnectService(userId, provider);
        return { ...result, headers: { 'Content-Type': 'application/json', ...corsHeaders } };
      }
      if (action === 'status' && method === 'GET') {
        const result = await getServiceStatus(userId, provider);
        return { ...result, headers: { 'Content-Type': 'application/json', ...corsHeaders } };
      }
    }

    if (path === '/api/services/status' && method === 'GET') {
      const result = await getAllServicesStatus(userId);
      return { ...result, headers: { 'Content-Type': 'application/json', ...corsHeaders } };
    }

    // Spotify direct OAuth (for non-Spotify-login users).
    // Disabled deployments 404 instead of leaking the route's existence.
    if (ENABLE_SPOTIFY && path === '/api/spotify/auth-url' && method === 'GET') {
      const result = await getSpotifyAuthUrl(userId);
      return { ...result, headers: { 'Content-Type': 'application/json', ...corsHeaders } };
    }

    // Shared playlists (authenticated)
    if (path === '/api/shared-playlists' && method === 'GET') {
      const result = await listSharedPlaylists(userId);
      return jsonResponse(result.statusCode, result.body, corsHeaders);
    }

    if (path === '/api/shared-playlists' && method === 'POST') {
      const body = JSON.parse(event.body ?? '{}');
      const result = await createSharedPlaylist(userId, body);
      return jsonResponse(result.statusCode, result.body, corsHeaders);
    }

    if (path.startsWith('/api/shared-playlists/') && method === 'DELETE') {
      const shareId = path.split('/api/shared-playlists/')[1];
      if (!shareId) {
        return jsonResponse(400, { error: 'Missing shareId' }, corsHeaders);
      }
      const result = await deleteSharedPlaylist(userId, shareId);
      return jsonResponse(result.statusCode, result.body, corsHeaders);
    }

    if (path === '/api/services/sync-from-clerk' && method === 'POST') {
      const body = JSON.parse(event.body ?? '{}') as { provider?: string };
      if (!body.provider) {
        return jsonResponse(400, { error: 'Missing provider' }, corsHeaders);
      }
      const result = await syncFromClerk(userId, body.provider);
      return { ...result, headers: { 'Content-Type': 'application/json', ...corsHeaders } };
    }

    return jsonResponse(404, { error: 'Not found' }, corsHeaders);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const isAuthError = message.includes('Authorization') || message.includes('Unauthorized') || message.includes('JWT') || message.includes('token');
    if (isAuthError) {
      console.warn(JSON.stringify({
        event: 'auth_failure',
        path,
        method,
        reason: message,
        sourceIp: event.requestContext?.http?.sourceIp,
      }));
      return jsonResponse(401, { error: 'Unauthorized' }, corsHeaders);
    }
    console.error(JSON.stringify({
      event: 'unhandled_error',
      path,
      method,
      error: message,
    }));
    return jsonResponse(500, { error: 'Internal server error' }, corsHeaders);
  }
};
