# API Design: Spotify Support

Feature: spotify-support
Status: Design
Created: 2026-03-25

---

## 1. Overview

This document specifies the API contracts, data structures, and data flows required to add Spotify as a second `MusicServiceAdapter` implementation alongside the existing Apple Music adapter.

The existing infrastructure is well-prepared: Clerk stores Spotify OAuth tokens under `oauth_spotify`, the `connectService` route already accepts `spotify` as a valid provider, `getConnectedServices` already decrypts and returns Spotify tokens from DynamoDB, and `index.ts` already detects `connectedServices.has('spotify')` with a placeholder comment. The DynamoDB schema and KMS encryption path are already shared. The primary work is:

1. Implementing `SpotifyApiClient` and `SpotifyAdapter`.
2. Replacing the Apple Music-specific token shape with a union type.
3. Registering service-prefixed tools when both services are connected.
4. Adding a proactive token-refresh path for Spotify's 1-hour expiry.

---

## 2. Token Management Changes

### 2a. The Core Problem

The `UserTokens` type in `token-manager.ts` is currently:

```ts
export interface UserTokens {
  developerToken: string;
  userToken: string;
}
```

This shape matches Apple Music (developer JWT + user music token) but maps poorly to Spotify (OAuth access token + refresh token). `services.ts` already works around this by writing `developerToken: ''` for Spotify, which is a hidden assumption baked into JSON stored in KMS-encrypted DynamoDB items.

### 2b. Token Shape Union

Replace the single `UserTokens` interface with a discriminated union. The encrypted JSON blob in DynamoDB will contain one of these shapes depending on the `service` sort key.

```ts
// shared/token-manager.ts

export interface AppleMusicTokens {
  kind: 'apple_music';
  developerToken: string;  // JWK-signed JWT, generated fresh per request
  userToken: string;       // Music-User-Token from Apple
}

export interface SpotifyTokens {
  kind: 'spotify';
  accessToken: string;    // OAuth access token, expires in ~1 hour
  refreshToken: string;   // Long-lived OAuth refresh token from Clerk
  expiresAt: number;      // Unix ms timestamp of access token expiry
}

export type ServiceTokens = AppleMusicTokens | SpotifyTokens;
```

`getUserTokens` return type changes from `UserTokens | null` to `ServiceTokens | null`. Callers narrow with `tokens.kind`.

`ConnectedService` in `getConnectedServices` currently exposes only `userToken: string`. This must be extended to carry the full `ServiceTokens` so callers have everything they need without a second DynamoDB fetch.

```ts
export interface ConnectedService {
  connectedAt: string;
  tokens: ServiceTokens;
}
```

### 2c. Migration Compatibility

Existing Apple Music rows stored before this change have `{ developerToken, userToken }` without a `kind` discriminant. `getUserTokens` must handle this gracefully:

```
if parsed blob has no 'kind' field -> treat as AppleMusicTokens, set kind='apple_music'
```

This one-read upgrade path avoids a migration job. New writes always include `kind`.

### 2d. Spotify Token Refresh Flow

Spotify access tokens expire after approximately 3600 seconds. The MCP server is invoked per-request and must not present expired tokens to the Spotify Web API.

**Refresh Strategy: Lazy Refresh in the MCP-Server Handler**

The `packages/api` package already has `getOAuthTokenForProvider` in `clerk-oauth.ts`, which calls `client.users.getUserOauthAccessToken`. Clerk will return a fresh access token on each call (it handles refresh transparently via its backend SDK when the OAuth provider supports refresh tokens).

This means the mcp-server does not need to implement its own refresh loop. Instead, in `index.ts`, when building the `serviceMap` for Spotify:

1. Check `tokens.expiresAt`. If `Date.now() >= tokens.expiresAt - 60_000` (within 1 minute of expiry), call `refreshSpotifyTokens(userId)` before constructing the adapter.
2. `refreshSpotifyTokens` invokes Clerk's backend API (already available in `clerk-oauth.ts`) to get a fresh access token, updates the DynamoDB row with the new token and `expiresAt`, and returns the updated `SpotifyTokens`.
3. This refresh happens in the mcp-server Lambda, not the api Lambda, so the mcp-server package will need its own Clerk client (using the same `CLERK_SECRET_KEY_NAME` secret).

**Data Flow: Token Refresh**

```
MCP Request arrives
  -> validateApiKey -> userId
  -> getCachedServices(userId)
      [cache TTL is 5 min; SpotifyTokens.expiresAt may be stale]
  -> for 'spotify' entry:
       if tokens.expiresAt < now + 60s:
         refreshSpotifyTokens(userId)
           -> Clerk backend SDK getUserOauthAccessToken('oauth_spotify')
           -> receives new accessToken + expiresAt
           -> storeUserTokens(userId, 'spotify', updatedTokens)
           -> invalidate serviceCache for this userId
         use refreshed tokens
       else:
         use cached tokens
  -> construct SpotifyAdapter(accessToken)
```

The 5-minute `serviceCache` in `index.ts` must be invalidated after a refresh, otherwise the stale access token persists in memory until the cache TTL expires. The simplest approach is to set `serviceCache = null` after a successful refresh write.

**DynamoDB Item Written by `connectService` for Spotify**

The `services.ts` route currently writes `{ developerToken: '', userToken: token }`. After this change it writes:

```json
{
  "kind": "spotify",
  "accessToken": "<oauth access token from Clerk>",
  "refreshToken": "<oauth refresh token>",
  "expiresAt": 1234567890000
}
```

Clerk's `getUserOauthAccessToken` response includes a `token` field (the access token) but does not surface the raw refresh token directly. The expiry is available as `expiresAt` on the token object. The `syncFromClerk` route and `connectService` route need to be updated to write the full `SpotifyTokens` shape instead of the current stub.

---

## 3. Spotify Adapter Architecture

### 3a. File Structure

```
packages/mcp-server/src/services/spotify/
  api-client.ts     - HTTP layer (spotifyFetch)
  adapter.ts        - SpotifyAdapter implements MusicServiceAdapter
```

This mirrors the Apple Music structure exactly.

### 3b. SpotifyApiClient Contract (`api-client.ts`)

```
Function: spotifyFetch
Signature: (endpoint: string, accessToken: string, options?: RequestInit) -> Promise<unknown>

Base URL: https://api.spotify.com/v1

Authorization header: Bearer <accessToken>
Content-Type: application/json

Retry logic: identical to appleMusicFetch
  - MAX_RETRIES = 3
  - Exponential backoff starting at 1000ms
  - 429 -> RateLimitError (read Retry-After header)
  - 401 -> SpotifyTokenExpiredError (extends TokenExpiredError)
  - non-2xx -> MusicServiceError

Spotify-specific: 204 No Content responses are valid success (return null).
Spotify-specific: 401 status means the access token is expired or revoked.
  Throw SpotifyTokenExpiredError, which index.ts catches and converts to
  the existing TokenExpiredError JSON-RPC error response (-32002).
```

### 3c. SpotifyAdapter Contract (`adapter.ts`)

```
Class: SpotifyAdapter implements MusicServiceAdapter
Constructor: (accessToken: string)
serviceName: 'spotify'
```

The adapter accepts `tokens: ServiceTokens` on each method call. It only reads `tokens.accessToken` (after narrowing to `SpotifyTokens`). This matches the Apple Music pattern where the adapter also receives tokens per-call to allow future per-request refresh without restructuring.

### 3d. Spotify Web API Endpoint Mapping

All 8 `MusicServiceAdapter` operations and their Spotify Web API counterparts:

**searchCatalog**
```
GET /search
Query params: q={query}, type={types joined with ','}, market=US, limit={limit}
Spotify types map: 'songs' -> 'track', 'albums' -> 'album', 'artists' -> 'artist'
Response: { tracks: { items: SpotifyTrack[] }, albums: { items: ... }, artists: { items: ... } }
SpotifyTrack shape:
  id: string
  name: string
  artists: [{ name: string }]
  album: { name: string }
  duration_ms: number
  explicit: boolean
Map to Track: id, name, artistName=artists[0].name, albumName=album.name, durationMs=duration_ms
Note: SearchParams.storefront maps to Spotify's 'market' parameter.
```

**listPlaylists**
```
GET /me/playlists
Query params: limit={limit}, offset={offset}
Max limit: 50 (Spotify cap; mcp-server tool schema must be updated from 100 to 50)
Response: { items: SpotifyPlaylist[], total: number, next: string | null }
SpotifyPlaylist shape:
  id: string
  name: string
  description: string | null
  tracks: { total: number }
Map to Playlist: id, name, description, trackCount=tracks.total
```

**getPlaylistTracks**
```
GET /playlists/{playlistId}/tracks
Query params: limit=50, offset={offset}, fields=items(track(id,name,artists,album,duration_ms)),next
Paginate: follow 'next' URL until null (same pattern as Apple Music adapter)
SpotifyPlaylistTrack shape: { track: SpotifyTrack | null }
Filter: skip items where track is null (local files, deleted tracks)
Map to Track: same as searchCatalog
Note: Spotify playlist IDs are alphanumeric + no dots. Validation regex: /^[a-zA-Z0-9]+$/
```

**createPlaylist**
```
Step 1: GET /me to retrieve the current user's Spotify user ID (userId)
Step 2: POST /users/{userId}/playlists
  Body: { name: string, description?: string, public: false }
  Response: { id: string, name: string }
Step 3 (if trackIds provided): POST /playlists/{playlistId}/tracks
  Body: { uris: trackIds.map(id => 'spotify:track:' + id) }
Map to CreatePlaylistResult: { id, name }
Note: Unlike Apple Music, Spotify playlists CAN be renamed and modified.
  The create_playlist tool description must be updated to remove the Apple
  Music-specific "CANNOT be deleted" warning when called for Spotify.
  This is another reason to use service-prefixed tool names (see Section 4).
```

**addTracks**
```
POST /playlists/{playlistId}/tracks
Body: { uris: trackIds.map(id => 'spotify:track:' + id) }
Spotify limit: 100 tracks per request (matches current tool schema max)
Response: { snapshot_id: string } on success (204 not returned for this endpoint)
Note: Spotify track IDs must be bare IDs, not URIs, in the MCP interface.
  The adapter handles the conversion to spotify:track:{id} URI format internally.
```

**getRecentlyPlayed**
```
GET /me/player/recently-played
Query params: limit={limit}
Max limit: 50 (Spotify cap; mcp-server tool schema must be updated from 30 to 50)
Response: { items: [{ track: SpotifyTrack, played_at: string }] }
Requires scope: user-read-recently-played
Map to Track: same as searchCatalog
```

**getLibrarySongs**
```
GET /me/tracks
Query params: limit={limit}, offset={offset}
Max limit: 50 (Spotify cap; mcp-server tool schema must be updated from 100 to 50)
Response: { items: [{ track: SpotifyTrack, added_at: string }], total: number }
Requires scope: user-library-read
Map to Track: same as searchCatalog
```

**addToLibrary**
```
Songs: PUT /me/tracks
  Body: { ids: songIds } (plain IDs, not URIs)
  Max: 50 IDs per request; batch if more
  Requires scope: user-library-modify

Albums: PUT /me/albums
  Body: { ids: albumIds }
  Max: 20 IDs per request; batch if more
  Requires scope: user-library-modify

Return: void on success (204 No Content)
```

### 3e. Required Spotify OAuth Scopes

These scopes must be requested when the user connects Spotify via Clerk:

```
playlist-read-private
playlist-read-collaborative
playlist-modify-private
playlist-modify-public
user-library-read
user-library-modify
user-read-recently-played
```

---

## 4. Tool Registration Strategy

### Decision: Service-Prefixed Tools When Both Services Are Connected

**Rationale:**

When only one service is connected, use unprefixed tool names (current behavior) for simplicity and backward compatibility. When both services are connected, use prefixed tool names to eliminate ambiguity for both the LLM and the user.

The core issue with shared/unprefixed tools is that `create_playlist` has materially different behavior on Apple Music (irreversible, cannot be renamed) versus Spotify (normal mutability). Using the same tool name with the same description would force the description to be misleading for one of the two services. Service-prefixed tools allow each service to carry accurate descriptions.

**Tool Naming Contract**

```
Single service connected:
  search_catalog, list_playlists, get_playlist_tracks, create_playlist,
  add_tracks, get_recently_played, get_library_songs, add_to_library
  (existing behavior, no change)

Both services connected:
  apple_music_search_catalog, apple_music_list_playlists, ...
  spotify_search_catalog, spotify_list_playlists, ...
```

**`mcp-server.ts` Changes**

```
ServiceEntry.adapter type changes from AppleMusicAdapter to MusicServiceAdapter.

registerAppleMusicTools(server, adapter, tokens) becomes:
  registerServiceTools(server, adapter, tokens, prefix)
  where prefix is '' when single service, 'apple_music_' or 'spotify_' when multi.

createMcpServer gains logic:
  const prefixed = services.size > 1;
  for (const [key, entry] of services) {
    const prefix = prefixed ? key + '_' : '';
    registerServiceTools(server, entry.adapter, entry.tokens, prefix);
  }
```

**`ServiceEntry` Interface Change**

```ts
// mcp-server.ts
import type { MusicServiceAdapter } from './services/types.js';
import type { ServiceTokens } from './shared/token-manager.js';

export interface ServiceEntry {
  adapter: MusicServiceAdapter;  // was: AppleMusicAdapter
  tokens: ServiceTokens;         // was: UserTokens
}
```

**Tool Descriptions Under Prefixing**

Each service gets its own description strings. Key differences:

```
apple_music_create_playlist description includes:
  "WARNING: Playlists created via the Apple Music API CANNOT be deleted, renamed,
   or modified after creation."

spotify_create_playlist description omits that warning.

apple_music_add_tracks description includes:
  "WARNING: Tracks are appended only. They cannot be removed or reordered via
   the Apple Music API. This action is irreversible."

spotify_add_tracks description omits that warning.
```

---

## 5. Multi-Service Handling

### When User Has Both Services Connected

With prefixed tools registered, the LLM and user navigate multi-service scenarios explicitly:

- "Search for Taylor Swift on Spotify" -> calls `spotify_search_catalog`
- "Add this song to my Apple Music library" -> calls `apple_music_add_to_library`
- "List my playlists" -> LLM must ask "Which service?" (both tools are available)

There is no implicit routing or cross-service fallback. The tool name is the routing key.

### ID Namespacing Concern

Spotify IDs and Apple Music IDs can collide (both are opaque strings). A track ID from `spotify_search_catalog` cannot be passed to `apple_music_add_tracks`. The tool descriptions must call this out:

```
"Track IDs returned by spotify_* tools are Spotify IDs and are only valid
 for other spotify_* tools."
```

### Cache Invalidation on Refresh

If a Spotify token refresh occurs during a request, `serviceCache = null` is set in `index.ts`. The next request rebuilds the cache with the fresh token. The 5-minute TTL is acceptable for Apple Music tokens (which do not expire during normal session) but is shortened effectively to zero on any Spotify refresh event.

---

## 6. Error Handling Patterns Specific to Spotify

### New Error Class: SpotifyTokenExpiredError

```ts
// shared/errors.ts

export class SpotifyTokenExpiredError extends TokenExpiredError {
  constructor(portalUrl: string) {
    super(
      portalUrl,
      'Spotify access token expired. Re-authorize at ' + portalUrl,
    );
  }
}
```

The existing `index.ts` catch block for `TokenExpiredError` already converts this to a JSON-RPC `-32002` error with `portalUrl` data. `SpotifyTokenExpiredError` extends `TokenExpiredError` so no changes to `index.ts` are required.

### HTTP 401 from Spotify

Spotify returns 401 when the access token is expired or invalid (not when the scope is insufficient — that returns 403). `spotifyFetch` must throw `SpotifyTokenExpiredError` on 401. The mcp-server should attempt one proactive refresh before surfacing the error to the user (see Section 2d).

### HTTP 403 from Spotify

403 means the request was valid but the user lacks the required scope. This happens if Spotify was connected without the necessary scopes. Throw `MusicServiceError` with a message indicating the missing scope so the error is actionable.

### Spotify Rate Limits (429)

Spotify's `Retry-After` header is in seconds, same as Apple Music. The existing `RateLimitError` class and retry logic in `appleMusicFetch` applies identically to `spotifyFetch`.

### Spotify Resource Not Found (404)

Spotify returns 404 for deleted playlists, tracks removed from catalog, etc. Throw `MusicServiceError(404, ...)`. The adapter surfaces this as a tool error response (isError: true).

### Batch Operation Partial Failure

`addToLibrary` on Spotify requires batching (50 songs/request, 20 albums/request). If one batch succeeds and the next fails, the operation is partially applied. The adapter should attempt all batches and throw with a summary of how many succeeded before failure, rather than failing fast. This differs from Apple Music's single-request behavior.

---

## 7. DynamoDB Item Shapes (Summary)

No new DynamoDB tables are required. Both services share the existing `UserMusicTokens` table with schema `PK=userId, SK=service`.

**Apple Music item (after migration):**
```json
{
  "userId": "user_abc",
  "service": "apple_music",
  "encryptedToken": "<KMS encrypted base64>",
  "connectedAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

Decrypted token blob:
```json
{ "kind": "apple_music", "developerToken": "", "userToken": "<Music-User-Token>" }
```

**Spotify item:**
```json
{
  "userId": "user_abc",
  "service": "spotify",
  "encryptedToken": "<KMS encrypted base64>",
  "connectedAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

Decrypted token blob:
```json
{
  "kind": "spotify",
  "accessToken": "<OAuth access token>",
  "refreshToken": "<OAuth refresh token>",
  "expiresAt": 1234567890000
}
```

---

## 8. Data Flow Diagrams

### 8a. Single-Service Request (Spotify Only Connected)

```
1. Claude Code (mcp-proxy)
   | HTTP POST to mcp.mixcraft.app
   | Authorization: Bearer mx_<apiKey>
   | Body: JSON-RPC { method: "tools/call", params: { name: "search_catalog", ... } }

2. API Gateway -> mcp-server Lambda (index.ts handler)
   | validateApiKey(apiKey) -> userId
   | getCachedServices(userId) -> Map { 'spotify' -> ConnectedService }

3. Token freshness check (index.ts)
   | SpotifyTokens.expiresAt vs Date.now()
   | if stale: refreshSpotifyTokens(userId) via Clerk backend SDK
   |           storeUserTokens(userId, 'spotify', updated)
   |           serviceCache = null

4. createMcpServer(serviceMap, portalUrl) (mcp-server.ts)
   | services.size === 1, prefix = ''
   | registerServiceTools(server, spotifyAdapter, tokens, '')
   | tools registered: search_catalog, list_playlists, ...

5. MCP request dispatched to SpotifyAdapter.searchCatalog(params)

6. spotifyFetch('GET /search?q=...', accessToken)
   | -> Spotify Web API (api.spotify.com/v1)
   | <- SpotifySearchResponse

7. SpotifyAdapter maps response to SearchResult { songs: Track[] }

8. JSON-RPC response -> API Gateway -> mcp-proxy -> Claude Code
```

### 8b. Multi-Service Request (Both Connected)

```
1-3. Same as above but getCachedServices returns both 'apple_music' and 'spotify'

4. createMcpServer(serviceMap, portalUrl) (mcp-server.ts)
   | services.size === 2, prefix = service key + '_'
   | registerServiceTools(server, appleAdapter, appleTokens, 'apple_music_')
   | registerServiceTools(server, spotifyAdapter, spotifyTokens, 'spotify_')
   | tools registered: apple_music_search_catalog, spotify_search_catalog, ...

5. MCP tool call arrives for 'spotify_list_playlists'
   | Routed to SpotifyAdapter.listPlaylists(tokens, limit, offset)

6. spotifyFetch('GET /me/playlists?limit=...', accessToken)
   | -> Spotify Web API
   | <- SpotifyPlaylistResponse

7. SpotifyAdapter maps to Playlist[]

8. JSON-RPC response returned
```

### 8c. Token Refresh Flow

```
mcp-server Lambda cold start OR serviceCache expired (5 min TTL)
  |
  getConnectedServices(userId) [DynamoDB Query]
  |
  for each item: decryptToken -> parse JSON -> build SpotifyTokens
  |
  index.ts: tokens.expiresAt < Date.now() + 60_000?
  |                                       YES
  |  Clerk backend SDK: getUserOauthAccessToken(userId, 'oauth_spotify')
  |  <- { token: newAccessToken, expiresAt: newExpiry }
  |
  storeUserTokens(userId, 'spotify', { kind:'spotify', accessToken:newAccessToken, ... })
  [DynamoDB PutItem with KMS encryption]
  |
  serviceCache = null  [force re-read on next request]
  |
  SpotifyAdapter constructed with fresh accessToken
```

---

## 9. Files to Create or Modify

**New files:**
- `packages/mcp-server/src/services/spotify/api-client.ts`
- `packages/mcp-server/src/services/spotify/adapter.ts`

**Modified files:**
- `packages/mcp-server/src/shared/token-manager.ts` — union token types, updated `ConnectedService`, migration compat
- `packages/mcp-server/src/shared/errors.ts` — add `SpotifyTokenExpiredError`
- `packages/mcp-server/src/services/types.ts` — update `MusicServiceAdapter` method signatures to accept `ServiceTokens` instead of `{ developerToken, userToken }`
- `packages/mcp-server/src/mcp-server.ts` — `ServiceEntry.adapter` type widened; `registerAppleMusicTools` generalized to `registerServiceTools` with prefix; multi-service logic
- `packages/mcp-server/src/index.ts` — Spotify service map construction; token refresh check
- `packages/api/src/routes/services.ts` — write full `SpotifyTokens` shape (with `kind`, `expiresAt`) instead of stub
- `packages/api/src/routes/sync-from-clerk.ts` — pass expiry from Clerk token response when syncing Spotify

**No new DynamoDB tables, no CDK infrastructure changes required** beyond adding the Spotify OAuth scopes to the Clerk configuration and ensuring the Clerk backend secret is accessible to the mcp-server Lambda (it already uses `CLERK_SECRET_KEY_NAME`).
