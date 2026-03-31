#!/usr/bin/env node
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
  // Priority 1: MIXCRAFT_API_KEY env var (deprecated)
  const apiKey = process.env.MIXCRAFT_API_KEY;
  if (apiKey) {
    console.error(
      'Warning: API key authentication is deprecated and will be removed.\n' +
      "Run 'npx mixcraft-app@latest login' to switch to OAuth.\n",
    );
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

async function main(): Promise<void> {
  let bearerToken: string;

  if (process.env.MIXCRAFT_API_KEY) {
    console.error(
      'Warning: API key authentication is deprecated and will be removed.\n' +
      "Run 'npx mixcraft-app@latest login' to switch to OAuth.\n",
    );
    bearerToken = process.env.MIXCRAFT_API_KEY;
  } else {
    const config = await discoverOAuthConfig();
    bearerToken = await resolveToken(config);
  }

  const remoteTransport = new StreamableHTTPClientTransport(
    new URL(API_URL),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
      },
    },
  );

  const remoteClient = new Client({
    name: 'mixcraft-cli',
    version: '1.0.0',
  });

  await remoteClient.connect(remoteTransport);

  const { tools } = await remoteClient.listTools();

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

// Only run main when executed directly (not when imported by tests)
const isMain = process.argv[1] != null &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMain) {
  main().catch((err) => {
    console.error('Fatal:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
