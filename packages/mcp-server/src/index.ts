import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { validateApiKey } from './auth/api-key.js';
import { getConnectedServices, type ConnectedService } from './shared/token-manager.js';
import { generateDeveloperToken } from './services/apple-music/jwt.js';
import { AppleMusicAdapter } from './services/apple-music/adapter.js';
import { createMcpServer, type ServiceEntry } from './mcp-server.js';
import {
  AuthenticationError,
  TokenExpiredError,
  RateLimitError,
} from './shared/errors.js';

// Minimal API Gateway types (avoids @types/aws-lambda dependency)
interface APIGatewayProxyEventV2 {
  requestContext: {
    http: { method: string; path: string };
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

const PORTAL_URL = process.env.PORTAL_URL ?? '';
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
    // 2. Validate API key -> get userId
    const { userId } = await validateApiKey(apiKey);

    // 3. Get connected services (cached)
    const connectedServices = await getCachedServices(userId);

    // 4. Build adapter map for connected services
    const serviceMap = new Map<string, ServiceEntry>();

    if (connectedServices.has('apple_music')) {
      const developerToken = await generateDeveloperToken();
      const { userToken } = connectedServices.get('apple_music')!;
      const adapter = new AppleMusicAdapter(developerToken);
      const tokens = { developerToken, userToken };
      serviceMap.set('apple_music', { adapter, tokens });
    }

    // 5. Create MCP server with connected services
    const mcpServer = createMcpServer(serviceMap, PORTAL_URL);

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

    return {
      statusCode: webResponse.status,
      headers: {
        ...corsHeaders,
        'Content-Type':
          webResponse.headers.get('Content-Type') ?? 'application/json',
      },
      body: responseBody,
    };
  } catch (err) {
    if (err instanceof AuthenticationError) {
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

    console.error('Unhandled error:', err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: jsonRpcError(
        jsonRpcId,
        -32603,
        err instanceof Error ? err.message : 'Internal server error',
      ),
    };
  }
};
