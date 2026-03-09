#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_URL = 'https://mcp.mixcraft.app/mcp';

const apiKey = process.env.MIXCRAFT_API_KEY;
if (!apiKey) {
  console.error(
    'Error: MIXCRAFT_API_KEY environment variable is required.\n' +
    'Get your API key at https://mixcraft.app and set it:\n' +
    '  export MIXCRAFT_API_KEY=mx_your_key_here',
  );
  process.exit(1);
}

interface JsonSchemaProp {
  type?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  items?: { type?: string };
}

/**
 * Convert a JSON Schema property definition to a Zod schema.
 */
function jsonSchemaToZod(prop: JsonSchemaProp): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (prop.type) {
    case 'number':
    case 'integer': {
      let num: z.ZodTypeAny = z.number();
      if (prop.minimum !== undefined) num = (num as z.ZodNumber).min(prop.minimum);
      if (prop.maximum !== undefined) num = (num as z.ZodNumber).max(prop.maximum);
      schema = num;
      break;
    }
    case 'boolean':
      schema = z.boolean();
      break;
    case 'array':
      schema = z.array(
        prop.items?.type === 'number' ? z.number() : z.string(),
      );
      break;
    default:
      schema = z.string();
      break;
  }

  if (prop.description) {
    schema = schema.describe(prop.description);
  }
  if (prop.default !== undefined) {
    schema = schema.optional().default(prop.default);
  }

  return schema;
}

/**
 * Build a Zod raw shape from the remote tool's properties.
 * The remote may return properties in inputSchema.properties or in annotations.
 */
function buildZodShape(tool: {
  inputSchema?: { properties?: Record<string, JsonSchemaProp> };
  annotations?: Record<string, unknown>;
}): Record<string, z.ZodTypeAny> {
  // Prefer inputSchema.properties; fall back to annotations if properties is empty
  const props = tool.inputSchema?.properties;
  const source = props && Object.keys(props).length > 0
    ? props
    : (tool.annotations as Record<string, JsonSchemaProp> | undefined) ?? {};

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, def] of Object.entries(source)) {
    if (typeof def === 'object' && def !== null && 'type' in def) {
      shape[key] = jsonSchemaToZod(def);
    }
  }
  return shape;
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
    version: '0.2.0',
  });

  await remoteClient.connect(remoteTransport);

  // Discover remote tools
  const { tools } = await remoteClient.listTools();

  // Create local stdio server that mirrors remote tools
  const localServer = new McpServer({
    name: 'mixcraft-app',
    version: '0.2.0',
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
