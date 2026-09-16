#!/usr/bin/env node
import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildZodShape } from './schema.js';
import {
  loadCachedToken,
  saveCachedToken,
  isTokenExpired,
} from './auth/token-cache.js';
import { refreshAccessToken, loginViaBrowser } from './auth/oauth-login.js';
import { withReauth } from './auth/reauth.js';

const API_URL = 'https://mcp.mixcraft.app/mcp';
const METADATA_URL = 'https://mcp.mixcraft.app/.well-known/oauth-authorization-server';

const OAUTH_CLIENT_ID = process.env.MIXCRAFT_OAUTH_CLIENT_ID ?? '';

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

export async function resolveToken(config: OAuthConfig): Promise<string> {
  // Priority 1: MIXCRAFT_API_KEY env var
  const apiKey = process.env.MIXCRAFT_API_KEY;
  if (apiKey) {
    return apiKey;
  }

  // Priority 2: Cached OAuth token
  const cached = loadCachedToken();
  if (cached) {
    if (!isTokenExpired(cached)) {
      return cached.accessToken;
    }

    // Try refresh
    try {
      console.error('Refreshing access token...');
      const refreshed = await refreshAccessToken({
        tokenUrl: config.tokenUrl,
        clientId: config.clientId,
        refreshToken: cached.refreshToken,
      });
      saveCachedToken(refreshed);
      return refreshed.accessToken;
    } catch {
      console.error('Token refresh failed. Re-authenticating...');
    }
  }

  // Priority 3: Browser-based login
  const token = await loginViaBrowser({
    authorizeUrl: config.authorizeUrl,
    tokenUrl: config.tokenUrl,
    clientId: config.clientId,
  });
  saveCachedToken(token);
  return token.accessToken;
}

/**
 * Obtain a fresh access token after the server rejected the current one, so we
 * bypass the local not-expired shortcut in `resolveToken`. Refreshes with the
 * cached refresh token, falling back to a browser login if that fails.
 */
export async function forceRefreshToken(config: OAuthConfig): Promise<string> {
  const cached = loadCachedToken();
  if (cached) {
    try {
      const refreshed = await refreshAccessToken({
        tokenUrl: config.tokenUrl,
        clientId: config.clientId,
        refreshToken: cached.refreshToken,
      });
      saveCachedToken(refreshed);
      return refreshed.accessToken;
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
  return token.accessToken;
}

function connectRemote(
  bearerToken: string,
): { client: Client; transport: StreamableHTTPClientTransport } {
  const transport = new StreamableHTTPClientTransport(new URL(API_URL), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    },
  });
  const client = new Client({ name: 'mixcraft-cli', version: '1.0.0' });
  return { client, transport };
}

async function main(): Promise<void> {
  let bearerToken: string;
  // Present only for OAuth sessions; a static API key cannot be refreshed.
  let oauthConfig: OAuthConfig | undefined;

  if (process.env.MIXCRAFT_API_KEY) {
    bearerToken = process.env.MIXCRAFT_API_KEY;
  } else {
    oauthConfig = await discoverOAuthConfig();
    bearerToken = await resolveToken(oauthConfig);
  }

  // Mutable so a mid-session re-auth can swap in a freshly-authenticated
  // client without disturbing the local tool handlers, which close over
  // `session` rather than a specific client instance.
  const session = connectRemote(bearerToken);

  await session.client.connect(session.transport);

  // OAuth access tokens are short-lived while this proxy is long-lived. When
  // the server rejects an expired token mid-session, refresh once and rebuild
  // the connection so the next call carries a valid token — rather than
  // hammering the server with a dead credential.
  const reauth = async (): Promise<void> => {
    if (!oauthConfig) return; // API key: nothing to refresh, let it surface.
    const fresh = await forceRefreshToken(oauthConfig);
    try {
      await session.transport.close();
    } catch {
      // Best effort — the old transport is being discarded regardless.
    }
    const next = connectRemote(fresh);
    await next.client.connect(next.transport);
    session.client = next.client;
    session.transport = next.transport;
  };

  const { tools } = await session.client.listTools();

  const localServer = new McpServer({
    name: 'mixcraft-app',
    version: '1.0.0',
  });

  for (const tool of tools) {
    const zodShape = buildZodShape(tool as Parameters<typeof buildZodShape>[0]);

    localServer.tool(
      tool.name,
      tool.description ?? '',
      zodShape,
      async (args: Record<string, unknown>) => {
        const result = await withReauth(
          () =>
            session.client.callTool({
              name: tool.name,
              arguments: args,
            }),
          reauth,
        );
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
