# Mixcraft Project Status

> Last updated: 2026-03-09

## What Is Mixcraft

A hosted MCP server that acts as an authenticated proxy between Claude Code and music services. Users connect their music accounts through a web portal, get an API key, and use `npx mixcraft-app` to give Claude access to their music library.

## Architecture

```
Claude Code  ←stdio→  CLI (npx mixcraft-app)  ←HTTP→  Lambda MCP Server  ←REST→  Apple Music API
                                                           ↓
                                                      DynamoDB (users, API keys, encrypted tokens)
                                                           ↓
                                                      KMS (token encryption)
```

### Monorepo Structure (pnpm)

| Package | Purpose | Status |
|---------|---------|--------|
| `packages/cli` | `npx mixcraft-app` — stdio-to-HTTP MCP proxy | Published v0.2.1 on npm |
| `packages/server` | Lambda MCP server with Apple Music adapter | Deployed (mcp.mixcraft.app) |
| `packages/portal` | React+Vite SPA — user self-service (Clerk auth, MusicKit OAuth) | Deployed (mixcraft.app) |
| `packages/portal-api` | Lambda — Clerk webhook, API key CRUD, token management | Deployed (api.mixcraft.app) |
| `packages/infra` | AWS CDK infrastructure | Deployed (Mixcraft-dev stack) |
| `packages/plugin` | Claude Code plugin | Not started |

### Domains

| Domain | Purpose |
|--------|---------|
| `mixcraft.app` | Portal SPA (S3 + CloudFront) |
| `api.mixcraft.app` | Portal API (API Gateway + Lambda) |
| `mcp.mixcraft.app` | MCP server endpoint (API Gateway + Lambda) |

### Key Infrastructure

- **DynamoDB Tables**: Users, ApiKeys, UserMusicTokens
- **KMS**: Token encryption key
- **Secrets Manager**: Apple developer credentials at `mixcraft/{env}/*`
- **Auth**: Clerk for portal, API keys (mx_ prefix) for MCP

## What's Built (Phases 1-2 Complete)

### 8 MCP Tools (Apple Music)
1. `search_catalog` — Search songs, albums, artists (public, no user token needed)
2. `list_playlists` — User's library playlists
3. `get_playlist_tracks` — Tracks in a specific playlist
4. `create_playlist` — Create playlist (WARNING: permanent, cannot be deleted via API)
5. `add_tracks` — Append tracks to playlist (WARNING: irreversible)
6. `get_recently_played` — Recent listening history
7. `get_library_songs` — Songs in user's library
8. `add_to_library` — Add songs/albums to library

### CLI Proxy (v0.2.1)
- Connects to `mcp.mixcraft.app/mcp` via StreamableHTTPClientTransport
- Reads `MIXCRAFT_API_KEY` env var for auth
- Converts remote JSON Schema tool definitions to Zod schemas for McpServer.tool()
- Published as `mixcraft-app` on npm with trusted publishing (OIDC, no NPM_TOKEN)

### CI/CD
- `.github/workflows/ci.yml` — Lint + build on push/PR to main
- `.github/workflows/publish.yml` — Publish to npm on GitHub release (trusted publishing, Node 22)

## Next Feature: Conditional Tool Registration

**Design doc**: `docs/plans/2026-03-09-conditional-tool-registration-design.md`

**Problem**: All 8 tools register regardless of whether the user has connected Apple Music. Wastes context window and produces cryptic errors. Gets worse as we add Spotify/Tidal.

**Solution**: Only register tools for connected services. Cache service status in Lambda module scope (5min TTL). If nothing connected, show a single `get_started` tool with onboarding instructions.

### Files to Change

1. **`packages/server/src/shared/token-manager.ts`**
   - Add `getConnectedServices(userId)` — DynamoDB Query on PK to get all service rows for a user
   - Currently uses GetCommand (single item). Need QueryCommand to fetch all services.
   - Returns `Map<string, { connectedAt, tokens }>` after KMS decryption

2. **`packages/server/src/index.ts`**
   - Replace `getUserTokens(userId, 'apple_music')` with cached `getConnectedServices(userId)`
   - Module-level cache: `{ userId, services, fetchedAt }` with 5min TTL
   - Build adapter map from connected services, pass to `createMcpServer()`
   - Still generate developer token (needed for all Apple Music calls)

3. **`packages/server/src/mcp-server.ts`**
   - Change signature: `createMcpServer(services: Map<string, { adapter, tokens }>)` instead of single adapter + tokens
   - Register tools conditionally per service
   - Add `get_started` fallback when no services connected

### Key Code Patterns to Follow
- Tool registration pattern in `mcp-server.ts`: `server.tool(name, description, zodSchema, handler)`
- Error handling: catch and return `{ content: [{type: 'text', text: 'Error: ...'}], isError: true }`
- DynamoDB: uses `DynamoDBDocumentClient` from `@aws-sdk/lib-dynamodb`
- Token table schema: PK=`userId`, SK=`service`, attrs: `encryptedToken`, `connectedAt`, `updatedAt`

### No Changes Needed
- CLI proxy auto-mirrors whatever tools the server exposes
- Infrastructure — DynamoDB schema already supports multi-service (composite key)
- Portal — existing connection flow unchanged

## Future Phases

### Phase 3: Claude Code Plugin
- `packages/plugin/` — not started
- Would provide a more integrated experience than the CLI proxy

### Phase 4: Multi-Service Support
- Spotify adapter implementing `MusicServiceAdapter`
- Tidal adapter implementing `MusicServiceAdapter`
- Portal UI for connecting multiple services
- Tool disambiguation when multiple services are connected (prefix or selection)

## Development Notes

### MCP SDK (v1.27.1)
- `McpServer` (from `@modelcontextprotocol/sdk/server/mcp.js`) is the recommended high-level API
- `Server` (from `@modelcontextprotocol/sdk/server/index.js`) is deprecated
- `McpServer.tool()` requires Zod schemas, NOT plain JSON Schema objects
- Plain objects passed as schemas get misclassified as `annotations`

### Apple Music API Quirks
- Playlists created via API **cannot be deleted or renamed** — warn users
- Tracks appended to playlists **cannot be removed or reordered** — warn users
- Developer token: ES256 JWT, 2hr lifetime, cached in module scope
- User token: obtained via MusicKit JS OAuth in portal, stored KMS-encrypted in DynamoDB

### Deployment
- CDK bootstrap must be v30+ (`cdk bootstrap`)
- Uses `tsx` (not ts-node) for ESM compatibility
- Deploy: `cd packages/infra && npx cdk deploy --all`
- Secrets must exist at `mixcraft/{env}/*` paths before deploy
