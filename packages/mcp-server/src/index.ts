import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticate } from './auth/index.js';
import {
  getConnectedServices,
  storeUserTokens,
  type ConnectedService,
  type SpotifyTokens,
} from './shared/token-manager.js';
import { generateDeveloperToken } from './services/apple-music/jwt.js';
import { AppleMusicAdapter } from './services/apple-music/adapter.js';
import { SpotifyAdapter } from './services/spotify/adapter.js';
import { refreshSpotifyToken } from './shared/spotify-refresh.js';
import { getSpotifyTokenFromClerk } from './shared/clerk-spotify.js';
import { createMcpServer, type ServiceEntry } from './mcp-server.js';
import {
  AuthenticationError,
  UpstreamAuthError,
  TokenExpiredError,
  RateLimitError,
} from './shared/errors.js';

// Minimal API Gateway types (avoids @types/aws-lambda dependency)
interface APIGatewayProxyEventV2 {
  requestContext: {
    http: {
      method: string;
      path: string;
      sourceIp?: string;
      userAgent?: string;
    };
    requestId: string;
  };
  headers: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

interface APIGatewayProxyResultV2 {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

/**
 * Classify a presented bearer token by shape only — never its contents — so
 * auth failures can be attributed to a client type without logging secrets.
 */
function describeTokenKind(token: string): string {
  if (token.startsWith('mx_')) return 'api_key';
  if (token.split('.').length === 3) return 'jwt';
  return 'opaque';
}

const PORTAL_URL = process.env.PORTAL_URL ?? '';
// Read at call time so tests can toggle the flag without re-importing.
function isSpotifyEnabled(): boolean {
  return process.env.ENABLE_SPOTIFY === 'true';
}
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let serviceCache: {
  userId: string;
  services: Map<string, ConnectedService>;
  fetchedAt: number;
} | null = null;

async function getCachedServices(
  userId: string,
): Promise<Map<string, ConnectedService>> {
  const now = Date.now();
  if (
    serviceCache &&
    serviceCache.userId === userId &&
    now - serviceCache.fetchedAt < CACHE_TTL_MS
  ) {
    return serviceCache.services;
  }

  const services = await getConnectedServices(userId);
  serviceCache = { userId, services, fetchedAt: now };
  return services;
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    error: { code, message, ...(data !== undefined ? { data } : {}) },
    id,
  });
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
  };

  // Handle CORS preflight
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // OAuth metadata discovery (RFC 8414)
  if (
    event.requestContext.http.method === 'GET' &&
    event.requestContext.http.path === '/.well-known/oauth-authorization-server'
  ) {
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issuer: process.env.CLERK_OAUTH_AUTHORIZE_URL?.replace('/oauth/authorize', '') ?? '',
        authorization_endpoint: process.env.CLERK_OAUTH_AUTHORIZE_URL ?? '',
        token_endpoint: process.env.CLERK_OAUTH_TOKEN_URL ?? '',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
      }),
    };
  }

  // Reject GET on /mcp — SSE streaming not supported (spec requires 405 so clients fall back to POST-only)
  if (event.requestContext.http.method === 'GET') {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, Allow: 'POST, OPTIONS' },
      body: '',
    };
  }

  // 1. Extract API key from Authorization header
  const authHeader =
    event.headers['authorization'] ?? event.headers['Authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing or invalid Authorization header' }),
    };
  }
  const apiKey = authHeader.slice(7);

  // Parse request body to extract JSON-RPC id for error responses
  let parsedBody: unknown;
  let jsonRpcId: string | number | null = null;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf-8')
      : event.body ?? '';
    parsedBody = JSON.parse(rawBody);
    if (
      parsedBody &&
      typeof parsedBody === 'object' &&
      'id' in parsedBody
    ) {
      jsonRpcId = (parsedBody as { id: string | number | null }).id;
    }
  } catch {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: jsonRpcError(null, -32700, 'Parse error'),
    };
  }

  try {
    // 2. Authenticate -> get userId
    const { userId, authMethod, deprecated } = await authenticate(apiKey);
    console.log(JSON.stringify({ auth_method: authMethod, userId }));

    // 3. Get connected services (cached)
    const connectedServices = await getCachedServices(userId);

    // 4. Build adapter map for connected services
    const serviceMap = new Map<string, ServiceEntry>();

    if (connectedServices.has('apple_music')) {
      const developerToken = await generateDeveloperToken();
      const connectedService = connectedServices.get('apple_music')!;
      const adapter = new AppleMusicAdapter(developerToken);
      const tokens = {
        kind: 'apple_music' as const,
        developerToken,
        userToken: connectedService.tokens.kind === 'apple_music'
          ? connectedService.tokens.userToken
          : '',
      };
      serviceMap.set('apple_music', { adapter, tokens });
    }

    // Spotify is gated behind a deploy-time flag because Spotify's developer
    // program restricts apps to an allowlist that cannot be expanded for
    // public distribution. When the flag is off, no Spotify tools are
    // exposed via MCP regardless of stored tokens.
    if (isSpotifyEnabled()) {
      // Clerk OAuth users get fresh tokens from Clerk on every request.
      // API key users use stored tokens with refresh via Spotify client credentials.
      if (authMethod === 'clerk_oauth') {
        const clerkTokens = await getSpotifyTokenFromClerk(userId);
        if (clerkTokens) {
          const adapter = new SpotifyAdapter(clerkTokens.accessToken, async () => {
            console.log('Spotify 401 received, fetching fresh token from Clerk');
            const fresh = await getSpotifyTokenFromClerk(userId);
            if (fresh) {
              serviceCache = null;
              return fresh.accessToken;
            }
            return null;
          });
          serviceMap.set('spotify', { adapter, tokens: clerkTokens });
        }
      } else if (connectedServices.has('spotify')) {
        const spotifyService = connectedServices.get('spotify')!;
        let spotifyTokens = spotifyService.tokens;

        if (spotifyTokens.kind === 'spotify') {
          // Refresh token if near expiry (within 60s)
          if (Date.now() >= spotifyTokens.expiresAt - 60_000) {
            console.log('Spotify token near expiry, refreshing');
            try {
              const refreshed = await refreshSpotifyToken(userId);
              if (refreshed) {
                spotifyTokens = refreshed;
                serviceCache = null;
              }
            } catch (err) {
              console.error('Spotify token refresh failed:', err instanceof Error ? err.message : err);
            }
          }

          const adapter = new SpotifyAdapter(spotifyTokens.accessToken, async () => {
            console.log('Spotify 401 received, refreshing token');
            const refreshed = await refreshSpotifyToken(userId);
            if (refreshed) {
              spotifyTokens = refreshed;
              serviceCache = null;
              return refreshed.accessToken;
            }
            return null;
          });
          serviceMap.set('spotify', { adapter, tokens: spotifyTokens });
        }
      }
    }

    // 5. Create MCP server with connected services
    const mcpServer = createMcpServer(serviceMap, PORTAL_URL, userId);

    // 6. Process JSON-RPC request through MCP using WebStandard transport
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
      enableJsonResponse: true, // return JSON instead of SSE
    });

    await mcpServer.connect(transport);

    // Build a Web Standard Request from the Lambda event
    const url = `https://localhost${event.requestContext.http.path}`;
    const webRequest = new Request(url, {
      method: event.requestContext.http.method,
      headers: {
        'Content-Type': 'application/json',
        ...(event.headers as Record<string, string>),
      },
      body: JSON.stringify(parsedBody),
    });

    const webResponse = await transport.handleRequest(webRequest, {
      parsedBody,
    });

    // 7. Convert Web Standard Response to API Gateway response
    const responseBody = await webResponse.text();

    // Clean up
    await mcpServer.close();

    const responseHeaders: Record<string, string> = {
      ...corsHeaders,
      'Content-Type':
        webResponse.headers.get('Content-Type') ?? 'application/json',
    };

    if (deprecated) {
      responseHeaders['X-Mixcraft-Deprecation'] =
        'API keys are deprecated and will be removed. Migrate to OAuth. See https://mixcraft.app/docs/oauth';
    }

    return {
      statusCode: webResponse.status,
      headers: responseHeaders,
      body: responseBody,
    };
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof UpstreamAuthError) {
      // Enough context to tell a stale-token client apart from scanner noise
      // without ever logging token material.
      console.warn(JSON.stringify({
        event: 'auth_failure',
        reason: err.message,
        ...(err.upstreamStatus !== undefined
          ? { upstreamStatus: err.upstreamStatus }
          : {}),
        tokenKind: describeTokenKind(apiKey),
        sourceIp: event.requestContext.http.sourceIp,
        userAgent: event.requestContext.http.userAgent,
        requestId: event.requestContext.requestId,
      }));
      // 503 for upstream failures: the token was never judged, so telling the
      // client 401 would push it to discard a working credential and re-auth,
      // turning a Clerk blip into a re-authorization stampede.
      if (err instanceof UpstreamAuthError) {
        return {
          statusCode: 503,
          headers: { ...corsHeaders, 'Retry-After': '30' },
          body: JSON.stringify({ error: err.message }),
        };
      }

      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: err.message }),
      };
    }

    if (err instanceof TokenExpiredError) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: jsonRpcError(jsonRpcId, -32002, err.message, {
          portalUrl: err.portalUrl,
        }),
      };
    }

    if (err instanceof RateLimitError) {
      return {
        statusCode: 429,
        headers: {
          ...corsHeaders,
          'Retry-After': String(Math.ceil(err.retryAfterMs / 1000)),
        },
        body: jsonRpcError(jsonRpcId, -32003, err.message, {
          retryAfterMs: err.retryAfterMs,
        }),
      };
    }

    console.error('Unhandled error:', err instanceof Error ? err.message : err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: jsonRpcError(
        jsonRpcId,
        -32603,
        'Internal server error',
      ),
    };
  }
};
