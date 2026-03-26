# Mixcraft Project Status

> Last updated: 2026-03-25

## What Is Mixcraft

A hosted MCP server that acts as an authenticated proxy between Claude Code and music services. Users connect their music accounts (Apple Music, Spotify, or both) through a web portal, get an API key, and use `npx mixcraft-app` to give Claude access to their music library.

## Architecture

```
Claude Code  <-stdio->  CLI (npx mixcraft-app)  <-HTTP->  Lambda MCP Server  <-REST->  Apple Music API
                                                                |                \----->  Spotify API
                                                           DynamoDB (users, API keys, encrypted tokens)
                                                                |
                                                           KMS (token encryption)
                                                                |
                                                           Clerk (OAuth token refresh for Spotify)
```

### Monorepo Structure (pnpm)

| Package | Purpose | Status |
|---------|---------|--------|
| `packages/mcp-proxy` | `npx mixcraft-app` — stdio-to-HTTP MCP proxy | Published on npm |
| `packages/mcp-server` | Lambda MCP server with Apple Music + Spotify adapters | Deployed (mcp.mixcraft.app) |
| `packages/web` | React+Vite SPA — user self-service (Clerk auth, MusicKit/Spotify OAuth) | Deployed (mixcraft.app) |
| `packages/api` | Lambda — Clerk webhook, API key CRUD, token management | Deployed (api.mixcraft.app) |
| `packages/infra` | AWS CDK infrastructure | Deployed (Mixcraft-prod stack) |
| `packages/plugin` | Claude Code plugin with playlist assistant skill | Published |

### Domains

| Domain | Purpose |
|--------|---------|
| `mixcraft.app` | Portal SPA (S3 + CloudFront) |
| `api.mixcraft.app` | Portal API (API Gateway + Lambda) |
| `mcp.mixcraft.app` | MCP server endpoint (API Gateway + Lambda) |

### Key Infrastructure

- **DynamoDB Tables**: Users, ApiKeys, UserMusicTokens
- **KMS**: Token encryption key
- **Secrets Manager**: Apple developer credentials + Clerk secret at `mixcraft/{env}/*`
- **Auth**: Clerk for portal (supports Spotify + Apple social login), API keys (mx_ prefix) for MCP

## What's Built

### MCP Tools — Multi-Service

**8 shared tools** (registered for whichever service is connected):
1. `search_catalog` — Search songs, albums, artists
2. `list_playlists` — User's library playlists
3. `get_playlist_tracks` — Tracks in a specific playlist
4. `create_playlist` — Create playlist
5. `add_tracks` — Add tracks to playlist
6. `get_recently_played` — Recent listening history
7. `get_library_songs` — Songs in user's library
8. `add_to_library` — Add songs/albums to library

**6 Spotify-only tools** (registered only when Spotify is connected):
1. `remove_playlist` — Remove (unfollow) a playlist
2. `remove_tracks_from_playlist` — Remove specific tracks
3. `reorder_playlist_tracks` — Reorder tracks in a playlist
4. `update_playlist` — Rename, update description, change visibility
5. `remove_from_library` — Remove songs/albums from library
6. `get_top_items` — Top artists or tracks by listening history

**Provider-aware registration**: When both services are connected, all tools are prefixed (`apple_music_*`, `spotify_*`) with provider-specific descriptions. Apple Music tools warn about irreversibility; Spotify tools don't.

### Multi-Service Architecture

- `MusicServiceAdapter` interface with `supportedCapabilities` property
- `AppleMusicAdapter` — implements 8 base operations
- `SpotifyAdapter` — implements 8 base + 6 extra operations
- Discriminated token union (`AppleMusicTokens | SpotifyTokens`) with backward-compat migration
- Automatic Spotify token refresh via Clerk (proactive before expiry + reactive on 401)
- Service cache with 5-min TTL, invalidated on token refresh

### CLI Proxy
- Connects to `mcp.mixcraft.app/mcp` via StreamableHTTPClientTransport
- Reads `MIXCRAFT_API_KEY` env var for auth
- Published as `mixcraft-app` on npm with trusted publishing

### Claude Code Plugin
- MCP server auto-configured via `.mcp.json` in plugin
- Playlist assistant skill — curates with energy arcs, genre bridges, taste memory
- Installed via `/plugin marketplace add schuettc/mixcraft-app`

### Portal
- Dark "Studio Console" theme with DM Sans
- Clerk auth with Spotify and Apple social login
- Auto-sync OAuth tokens from social login (3x retry with backoff, failure alerts)
- Connect/disconnect buttons for both Apple Music and Spotify on Dashboard
- Setup page with numbered steps, completion redirects to Dashboard

### CI/CD
- `.github/workflows/ci.yml` — Lint + build on push/PR to main
- `.github/workflows/publish.yml` — Publish to npm on GitHub release (trusted publishing)

## Development Notes

### Apple Music API
- Playlists created via API **cannot be deleted or renamed** — warn users
- Tracks appended to playlists **cannot be removed or reordered** — warn users
- Developer token: ES256 JWT, 2hr lifetime, cached in module scope
- User token: obtained via MusicKit JS OAuth in portal, stored KMS-encrypted

### Spotify API
- Playlists can be renamed, updated, and removed (unfollowed)
- Tracks can be removed and reordered
- OAuth access tokens expire after ~1 hour, refreshed via Clerk backend SDK
- Token refresh: proactive (check `expiresAt` before request) + reactive (catch 401, refresh, retry once)
- Required scopes: `playlist-read-private`, `playlist-modify-private`, `user-library-read`, `user-library-modify`, `user-read-recently-played`

### Deployment
- CDK bootstrap must be v30+ (`cdk bootstrap`)
- Uses `tsx` (not ts-node) for ESM compatibility
- Deploy: `cd packages/infra && AWS_PROFILE=playlists npx cdk deploy --all`
- Secrets must exist at `mixcraft/{env}/*` paths before deploy
