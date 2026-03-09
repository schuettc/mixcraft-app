# Conditional Tool Registration with Cached Service Status

## Problem

All 8 MCP tools are registered regardless of whether the user has connected a music service. This wastes Claude's context window and produces cryptic errors when tools are called without valid tokens. As we add more services (Spotify, Tidal), this problem multiplies.

## Solution

Only register MCP tools for services the user has actually connected. Cache service status at the Lambda module level to minimize DynamoDB reads.

## Architecture

### Flow

1. API key validated → `userId` resolved
2. Query DynamoDB for all connected services for `userId` (cached 5min)
3. Create adapters only for connected services
4. Register tools only for services with valid adapters
5. If zero services connected, register a single `get_started` tool with onboarding instructions

### Cache Strategy

Module-scope cache keyed by `userId`:
- `{ userId, services: Map<string, { connectedAt, tokens }>, fetchedAt }`
- TTL: 5 minutes
- Refreshed on cold start or userId mismatch or TTL expiry

### Multi-Service Readiness

DynamoDB schema already supports multiple services per user (PK: `userId`, SK: `service`). When Spotify/Tidal adapters exist:
- Each connected service gets its own adapter instance
- Tools are registered per connected service
- Tool names may be prefixed to disambiguate if multiple services are connected

## Changes

### `packages/server/src/shared/token-manager.ts`
- Add `getConnectedServices(userId)` — DynamoDB Query on PK to get all service rows
- Returns `Map<string, { connectedAt, tokens }>` after decryption

### `packages/server/src/index.ts`
- Replace single `getUserTokens(userId, 'apple_music')` with `getConnectedServices(userId)`
- Add module-level cache with 5-minute TTL
- Pass `Map<serviceName, { adapter, tokens }>` to `createMcpServer()`

### `packages/server/src/mcp-server.ts`
- Change signature: accept `Map<string, { adapter, tokens }>` instead of single adapter + tokens
- Wrap tool registration in conditional blocks per service
- Add `get_started` fallback tool when no services are connected

### No changes needed
- CLI proxy (`packages/cli/`) — automatically mirrors whatever tools the server exposes
- Infrastructure — DynamoDB schema already supports multi-service
- Portal — existing connection flow unchanged
