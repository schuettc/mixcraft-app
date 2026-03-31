# Clerk OAuth for MCP Server

## Problem

The MCP server at `mcp.mixcraft.app` uses custom API keys (`mx_` prefix) for authentication. Claude.ai's cloud connectors require OAuth 2.0 (Client ID + Client Secret). Without OAuth support, remote Claude Code agents (scheduled triggers, cloud sessions) cannot access music services on behalf of users.

Additionally, maintaining two auth systems (Clerk JWTs for the portal, custom API keys for MCP) adds unnecessary complexity. Unifying on Clerk as the single identity provider simplifies the architecture.

## Solution

Add OAuth 2.0 support to the MCP server using Clerk as the authorization server. Deprecate custom API keys over a transition period.

## Architecture

### Auth Flow: Cloud Connector

```
Claude.ai Cloud Connector
    │
    │ 1. Discover auth metadata
    ▼
GET mcp.mixcraft.app/.well-known/oauth-authorization-server
    │
    │ Returns: { authorization_endpoint, token_endpoint, ... }
    │          (pointing to Clerk's OAuth endpoints)
    ▼
    │ 2. Redirect user to Clerk
    ▼
Clerk OAuth Authorization (clerk.mixcraft.app/oauth/authorize)
    │
    │ 3. User logs in via Clerk (or already signed in)
    │ 4. User consents to "Claude.ai accessing your music services"
    ▼
    │ 5. Clerk issues authorization code, redirects to Claude.ai callback
    ▼
Claude.ai exchanges code for token
    │
    │ POST to Clerk token endpoint with client_id + client_secret + code
    ▼
Clerk returns access token (JWT)
    │
    │ 6. Claude.ai sends Bearer token on all MCP requests
    ▼
MCP Server validates Clerk JWT → extracts userId → serves tools
```

### Auth Flow: CLI (`npx mixcraft-app`)

```
User runs: npx mixcraft-app
    │
    │ 1. No cached token? Open browser
    ▼
Browser: Clerk login at clerk.mixcraft.app
    │
    │ 2. User authenticates
    │ 3. Clerk redirects to localhost callback with code
    ▼
CLI exchanges code for token via Clerk token endpoint
    │
    │ 4. Cache token + refresh token locally (~/.mixcraft/token.json)
    ▼
CLI uses Bearer token for MCP requests
    │
    │ 5. On 401 or expiry, use refresh token to get new access token
    │ 6. If refresh fails, re-prompt browser login
```

### Auth Flow: Existing API Keys (Deprecated)

```
User sets MIXCRAFT_API_KEY=mx_...
    │
    ▼
MCP Server: Detect mx_ prefix → validate via existing DynamoDB lookup
    │
    │ Return deprecation header:
    │   X-Mixcraft-Deprecation: API keys sunset YYYY-MM-DD. Migrate to OAuth.
    │
    │ Log: { auth_method: "api_key", userId, keyPrefix }
    ▼
Serve request normally (no functionality change)
```

## MCP Server Changes

### New Endpoint: OAuth Metadata Discovery

**Route:** `GET /.well-known/oauth-authorization-server`

**Response:**
```json
{
  "issuer": "https://clerk.mixcraft.app",
  "authorization_endpoint": "https://clerk.mixcraft.app/oauth/authorize",
  "token_endpoint": "https://clerk.mixcraft.app/oauth/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"]
}
```

This is a static JSON response following [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) as referenced by the MCP auth spec. The actual endpoint URLs depend on how Clerk configures the OAuth application — the exact paths (`/oauth/authorize`, `/oauth/token`) may vary. Read them from environment variables (`CLERK_OAUTH_AUTHORIZE_URL`, `CLERK_OAUTH_TOKEN_URL`), not hardcoded.

**Note on Clerk JWT lifetimes:** Clerk JWTs are typically short-lived (configurable, often 60s by default). Cloud connectors and the CLI must handle token refresh. Clerk's OAuth flow issues refresh tokens alongside access tokens when `offline_access` scope is requested.

### Dual Auth in MCP Handler

The MCP Lambda handler (`packages/mcp-server/src/index.ts`) currently extracts the API key from the `Authorization: Bearer` header and calls `validateApiKey()`. The updated flow:

```
Extract token from Authorization: Bearer <token>
    │
    ├─ Token starts with "mx_"?
    │   YES → validateApiKey(token) → userId
    │         Add deprecation header to response
    │         Log { auth_method: "api_key" }
    │
    └─ Otherwise → validateClerkJwt(token) → userId
                   Log { auth_method: "clerk_oauth" }
    │
    ▼
Continue with userId → getConnectedServices → serve tools
```

**New module:** `packages/mcp-server/src/auth/clerk-jwt.ts`

Validates Clerk JWTs using `@clerk/backend` SDK's `verifyToken()`. Extracts `sub` claim as `userId`. This is the same pattern already used in `packages/api/src/shared/clerk.ts`.

**Dependencies:** The MCP server Lambda needs access to the Clerk secret key. Add `CLERK_SECRET_KEY_NAME` environment variable pointing to the Secrets Manager path (`mixcraft/{environment}/clerk-secret-key`). The secret is already stored there for the portal API.

### Infrastructure Changes

**`packages/infra/src/constructs/mcp-api.ts`:**
- Add `CLERK_SECRET_KEY_NAME` environment variable to the MCP Lambda
- Grant the MCP Lambda read access to the Clerk secret in Secrets Manager
- Add route for `GET /.well-known/oauth-authorization-server`

**`packages/infra/src/constructs/web.ts`:**
- Parameterize CSP headers: replace hardcoded `mixcraft.app` references with `${domainName}` to support dev environment

## Clerk OAuth Application Setup

### Dev Instance
- Create OAuth application in Clerk dev dashboard
- Set allowed redirect URIs:
  - Claude.ai's cloud connector callback URL
  - `http://localhost:8888/callback` (for CLI development)
- Note the `client_id` and `client_secret`

### Prod Instance (Phase 3)
- Same configuration in Clerk prod dashboard
- Production redirect URIs only

## Dev Environment Deployment

### What Already Works
- CDK accepts `environment` and `domainName` context variables
- Secret paths use `mixcraft/{environment}/*`
- DynamoDB table names are auto-generated per stack
- API Gateway domains use `api.${domainName}` and `mcp.${domainName}`
- Clerk dev keys exist (`pk_test_*`)

### What Needs Setup
1. **DNS:** Route53 hosted zone for `dev.mixcraft.app` (or add records to existing zone)
2. **Certificates:** ACM cert for `*.dev.mixcraft.app` and `dev.mixcraft.app`
3. **Secrets:** Upload dev secrets to `mixcraft/dev/*` paths in Secrets Manager
4. **CSP fix:** Parameterize hardcoded domain references in `web.ts`
5. **Deploy:** `cd packages/infra && AWS_PROFILE=playlists npx cdk deploy --all -c environment=dev -c domainName=dev.mixcraft.app -c clerkPublishableKey=pk_test_...`

## CLI Changes (`packages/mcp-proxy`)

### New: Browser-Based OAuth Login

Add a `login` command (or auto-trigger on first use when no token exists):

1. Start a temporary local HTTP server on `localhost:8888`
2. Open browser to Clerk's authorization URL with `redirect_uri=http://localhost:8888/callback`
3. User authenticates in browser
4. Clerk redirects to localhost with auth code
5. CLI exchanges code for access + refresh tokens
6. Store tokens in `~/.mixcraft/token.json`
7. Shut down local server

### Token Management

- On startup, check for cached token in `~/.mixcraft/token.json`
- If token is expired, use refresh token to get a new one
- If refresh fails, re-trigger browser login
- If `MIXCRAFT_API_KEY` env var is set, use it (with deprecation warning to stderr)

### Backwards Compatibility

- `MIXCRAFT_API_KEY` continues to work throughout the transition period
- CLI prints to stderr: `Warning: API key authentication is deprecated and will be removed on YYYY-MM-DD. Run 'npx mixcraft-app login' to switch to OAuth.`

## API Key Deprecation Plan

### Timeline
- **Day 0:** OAuth launches on prod. API keys continue to work with deprecation warnings.
- **Day 7:** Email/notification to users with active API keys who haven't migrated.
- **Day 14:** API key creation disabled in portal. Existing keys still work.
- **Day 21:** API keys stop working. All requests must use Clerk OAuth.

Exact dates set once OAuth ships to prod. Extend if adoption data shows users need more time.

### Monitoring
- Log `auth_method` on every MCP request (`api_key` vs `clerk_oauth`)
- Track migration progress: what percentage of requests use OAuth vs API keys
- Alert if API key usage isn't declining as expected

### Portal UI Changes
- API key management page: show deprecation banner with migration instructions
- Add "Connect via Claude.ai" instructions (cloud connector setup guide)
- Add "Login via CLI" instructions (`npx mixcraft-app login`)

## Phased Rollout

### Phase 1: Dev Environment
- Fix CSP parameterization in `web.ts`
- Set up DNS, certs, and secrets for `dev.mixcraft.app`
- Deploy dev stack
- Verify basic functionality (portal login, music service connection, MCP tools)

### Phase 2: OAuth on Dev
- Create Clerk OAuth application (dev instance)
- Add `/.well-known/oauth-authorization-server` endpoint to MCP server
- Add Clerk JWT validation to MCP handler (dual auth)
- Add deprecation header/logging for API key auth
- Update CLI with browser-based OAuth login
- Test end-to-end: cloud connector → Clerk OAuth → MCP tools
- Test end-to-end: CLI OAuth login → MCP tools
- Test: existing API keys still work with deprecation warnings

### Phase 3: Promote to Prod
- Create Clerk OAuth application (prod instance)
- Deploy to prod
- Announce API key deprecation timeline
- Update documentation and plugin
- Set up the weekly playlist cron job (the original goal)

## Testing Strategy

### Dev Environment Smoke Tests
- Portal loads at `dev.mixcraft.app`
- Clerk login works
- Music service connection works (Spotify OAuth, Apple Music)
- MCP tools work via API key
- MCP tools work via Clerk JWT

### OAuth Integration Tests
- Cloud connector discovery returns valid metadata
- OAuth flow completes and returns valid token
- MCP requests with Clerk JWT succeed
- MCP requests with API key succeed with deprecation header
- Token refresh works
- Expired tokens are rejected with 401
- Invalid tokens are rejected with 401

### CLI Tests
- `npx mixcraft-app login` opens browser and completes auth
- Token is cached and reused
- Token refresh works silently
- Fallback to browser login when refresh fails
- `MIXCRAFT_API_KEY` still works with warning

## Files to Create or Modify

### New Files
- `packages/mcp-server/src/auth/clerk-jwt.ts` — Clerk JWT validation
- `packages/mcp-server/src/auth/index.ts` — Unified auth module (try JWT, fall back to API key)
- `packages/mcp-proxy/src/auth/oauth-login.ts` — Browser-based OAuth login flow
- `packages/mcp-proxy/src/auth/token-cache.ts` — Local token storage and refresh

### Modified Files
- `packages/mcp-server/src/index.ts` — Dual auth, metadata endpoint, deprecation headers
- `packages/mcp-proxy/src/cli.ts` — OAuth login flow, token management, deprecation warning
- `packages/infra/src/constructs/mcp-api.ts` — Clerk secret access, metadata route
- `packages/infra/src/constructs/web.ts` — Parameterize CSP headers
