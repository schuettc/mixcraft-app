#!/usr/bin/env node
import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildZodShape } from './schema.js';
import {
  loadCachedToken,
  saveCachedToken,
  isTokenExpired,
  type CachedToken,
} from './auth/token-cache.js';
import { refreshAccessToken, loginViaBrowser } from './auth/oauth-login.js';
import { TokenManager } from './auth/token-manager.js';
import { createAuthFetch } from './auth/auth-fetch.js';

const API_URL = 'https://mcp.mixcraft.app/mcp';
const METADATA_URL = 'https://mcp.mixcraft.app/.well-known/oauth-authorization-server';

const OAUTH_CLIENT_ID = process.env.MIXCRAFT_OAUTH_CLIENT_ID ?? '';

function getVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require('../package.json') as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

const VERSION = getVersion();
// Identifies the proxy (and its version) in server-side logs, so auth failures
// can be attributed to a specific proxy version instead of the bare "node" UA.
const USER_AGENT = `mixcraft-app/${VERSION}`;

interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
}

async function discoverOAuthConfig(): Promise<OAuthConfig> {
  if (OAUTH_CLIENT_ID) {
    try {
      const response = await fetch(METADATA_URL);
      if (response.ok) {
        const metadata = (await response.json()) as {
          authorization_endpoint: string;
          token_endpoint: string;
        };
        return {
          authorizeUrl: metadata.authorization_endpoint,
          tokenUrl: metadata.token_endpoint,
          clientId: OAUTH_CLIENT_ID,
        };
      }
    } catch {
      // Fall through to error
    }
  }

  throw new Error(
    'OAuth not configured. Set MIXCRAFT_OAUTH_CLIENT_ID or use MIXCRAFT_API_KEY.\n' +
    'Get started at https://mixcraft.app',
  );
}

/**
 * Acquire the initial OAuth token for a session: use the cached token if it is
 * still valid, otherwise refresh it, and fall back to a browser login. The
 * long-lived refreshing during the session is handled by `TokenManager`.
 */
export async function acquireOAuthToken(
  config: OAuthConfig,
): Promise<CachedToken> {
  const cached = loadCachedToken();
  if (cached) {
    if (!isTokenExpired(cached)) {
      return cached;
    }

    try {
      console.error('Refreshing access token...');
      const refreshed = await refreshAccessToken({
        tokenUrl: config.tokenUrl,
        clientId: config.clientId,
        refreshToken: cached.refreshToken,
      });
      saveCachedToken(refreshed);
      return refreshed;
    } catch {
      console.error('Token refresh failed. Re-authenticating...');
    }
  }

  const token = await loginViaBrowser({
    authorizeUrl: config.authorizeUrl,
    tokenUrl: config.tokenUrl,
    clientId: config.clientId,
  });
  saveCachedToken(token);
  return token;
}

function createTransport(): StreamableHTTPClientTransport {
  const apiKey = process.env.MIXCRAFT_API_KEY;

  // API keys are static and non-expiring — a plain Authorization header is all
  // that's needed, with no refresh machinery.
  if (apiKey) {
    return new StreamableHTTPClientTransport(new URL(API_URL), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'user-agent': USER_AGENT,
        },
      },
    });
  }

  throw new Error('createTransport called without an API key');
}

async function main(): Promise<void> {
  let transport: StreamableHTTPClientTransport;

  if (process.env.MIXCRAFT_API_KEY) {
    transport = createTransport();
  } else {
    const config = await discoverOAuthConfig();
    const initial = await acquireOAuthToken(config);

    // Owns the token for the life of the session: refreshes proactively before
    // expiry and, on a 401, refreshes exactly once across concurrent callers.
    const manager = new TokenManager({
      initial,
      refresh: (refreshToken) =>
        refreshAccessToken({
          tokenUrl: config.tokenUrl,
          clientId: config.clientId,
          refreshToken,
        }),
      save: saveCachedToken,
    });

    // The token is stamped per-request by createAuthFetch, so a refresh takes
    // effect without rebuilding the transport or its MCP session.
    transport = new StreamableHTTPClientTransport(new URL(API_URL), {
      fetch: createAuthFetch(manager),
      requestInit: {
        headers: {
          'user-agent': USER_AGENT,
        },
      },
    });
  }

  const remoteClient = new Client({
    name: 'mixcraft-cli',
    version: VERSION,
  });

  await remoteClient.connect(transport);

  const { tools } = await remoteClient.listTools();

  const localServer = new McpServer({
    name: 'mixcraft-app',
    version: VERSION,
  });

  for (const tool of tools) {
    const zodShape = buildZodShape(tool as Parameters<typeof buildZodShape>[0]);

    localServer.tool(
      tool.name,
      tool.description ?? '',
      zodShape,
      async (args: Record<string, unknown>) => {
        const result = await remoteClient.callTool({
          name: tool.name,
          arguments: args,
        });
        return {
          content: result.content as Array<{ type: 'text'; text: string }>,
          isError: result.isError as boolean | undefined,
        };
      },
    );
  }

  const stdioTransport = new StdioServerTransport();
  await localServer.connect(stdioTransport);
}

// Only run main when executed directly (not when imported by tests).
// Use realpathSync to resolve npm bin symlinks before comparing.
const isMain = process.argv[1] != null && (() => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error('Fatal:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
