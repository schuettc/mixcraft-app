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

  try {
    // Webhook route (no auth required)
    if (path === '/api/auth/webhook' && method === 'POST') {
      const result = await handleWebhook(event);
      return { ...result, headers: corsHeaders };
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

    return jsonResponse(404, { error: 'Not found' }, corsHeaders);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const isAuthError = message.includes('Authorization') || message.includes('Unauthorized');
    if (isAuthError) {
      return jsonResponse(401, { error: 'Unauthorized' }, corsHeaders);
    }
    console.error('Unhandled error:', message);
    return jsonResponse(500, { error: 'Internal server error' }, corsHeaders);
  }
};
