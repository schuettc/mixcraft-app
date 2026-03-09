#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const API_URL = 'https://api.mixcraft.app/mcp';

const apiKey = process.env.MIXCRAFT_API_KEY;
if (!apiKey) {
  console.error(
    'Error: MIXCRAFT_API_KEY environment variable is required.\n' +
    'Get your API key at https://mixcraft.app and set it:\n' +
    '  export MIXCRAFT_API_KEY=mx_your_key_here',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  // Connect to remote MCP server
  const remoteTransport = new StreamableHTTPClientTransport(
    new URL(API_URL),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    },
  );

  const remoteClient = new Client({
    name: 'mixcraft-cli',
    version: '0.1.0',
  });

  await remoteClient.connect(remoteTransport);

  // Discover remote tools
  const { tools } = await remoteClient.listTools();

  // Create local stdio server that mirrors remote tools
  const localServer = new McpServer({
    name: 'mixcraft-app',
    version: '0.1.0',
  });

  for (const tool of tools) {
    localServer.tool(
      tool.name,
      tool.description ?? '',
      tool.inputSchema as Record<string, unknown>,
      async (args: Record<string, unknown>) => {
        const result = await remoteClient.callTool({
          name: tool.name,
          arguments: args,
        });
        return {
          content: (result.content as Array<{ type: 'text'; text: string }>),
          isError: result.isError as boolean | undefined,
        };
      },
    );
  }

  // Start stdio transport
  const stdioTransport = new StdioServerTransport();
  await localServer.connect(stdioTransport);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
