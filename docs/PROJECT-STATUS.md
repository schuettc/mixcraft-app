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

## Completed: Conditional Tool Registration

**Design doc**: `docs/plans/2026-03-09-conditional-tool-registration-design.md`

**Implemented 2026-03-09.** Only registers MCP tools for connected services. Shows `get_started` onboarding tool when no services are connected.

### What Changed
1. **`packages/server/src/shared/token-manager.ts`** — Added `getConnectedServices(userId)` using DynamoDB QueryCommand
2. **`packages/server/src/index.ts`** — Module-level cache (5min TTL), builds adapter map from connected services
3. **`packages/server/src/mcp-server.ts`** — Conditional registration: `get_started` fallback or all 8 Apple Music tools
4. **`packages/server/src/mcp-server.test.ts`** — Unit tests for both paths (connected/unconnected)

## Completed: Portal Redesign

**Implemented 2026-03-09.** Dark "Studio Console" theme with DM Sans (all sans-serif), warm amber/gold accents, styled modals for create/delete API keys, noise texture overlay.

**Updated 2026-03-09.** Consolidated from 3 pages (`/dashboard`, `/connect`, `/api-keys`) into a single `/setup` page with numbered steps: (1) Connect a Music Service, (2) Create an API Key, (3) Add to Claude Code. Completion checkmarks on steps 1-2. Disconnect confirmation modal added. Old pages and routes removed; `*` catches stale bookmarks.

## Next Feature: Claude Code Plugin

## Planned Portal Improvements

### Single API Key per User
Currently the portal supports multiple named API keys per user. This adds unnecessary complexity — users visit once to grab a config snippet. Simplify to one key per user:
- Remove key naming (no create modal, just a "Generate Key" button)
- If a key exists, show it masked with a "Regenerate" option (confirmation modal since it invalidates the old key)
- Step 2 becomes: "Your API Key" with generate/regenerate, no table
- Backend: enforce one key per user (or just soft-enforce in the portal)

### Multi-Service Support in Portal
Step 1 currently hardcodes Apple Music. When adding Spotify, Tidal, etc.:
- Extract a `<ServiceCard>` component (service name, status, connect/disconnect)
- Step 1 maps over available services, rendering a card for each
- Step-complete checkmark triggers when `connectedServices.length > 0`
- Each service uses its own hook (e.g., `useSpotify`) following the `useAppleMusic` pattern
- Service list could come from a config or from the portal API

### Clerk Production Setup
Currently using Clerk dev mode (`pk_test_` key). To switch to production:
1. In Clerk dashboard: create a production instance, add `mixcraft.app` as the domain
2. Get the production publishable key (`pk_live_...`) and secret key
3. Update `packages/infra/cdk.json` context `clerkPublishableKey` to the `pk_live_` value
4. Store the production secret key in Secrets Manager at `mixcraft/prod/clerk-secret-key`
5. Set up a new webhook endpoint in Clerk production pointing to `api.mixcraft.app/webhooks/clerk`, store the signing secret at `mixcraft/prod/clerk-webhook-secret`
6. Redeploy: `cd packages/infra && AWS_PROFILE=playlists npx cdk deploy --all`
7. Verify: login flow on `mixcraft.app` uses production Clerk (no dev banner)

## Future Phases

### Phase 3: Claude Code Plugin
- `packages/plugin/` — not started
- Would provide a more integrated experience than the CLI proxy

### Phase 4: Multi-Service Support
- Spotify adapter implementing `MusicServiceAdapter`
- Tidal adapter implementing `MusicServiceAdapter`
- Portal UI for connecting multiple services (see "Planned Portal Improvements" above)
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
- Deploy: `cd packages/infra && CDK_DEFAULT_ACCOUNT=298722972008 CDK_DEFAULT_REGION=us-east-1 AWS_PROFILE=playlists npx cdk deploy --all`
- Secrets must exist at `mixcraft/{env}/*` paths before deploy
