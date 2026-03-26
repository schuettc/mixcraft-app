---
started: 2026-03-25
---

# Implementation Plan: Spotify Support

## Overview
Add Spotify as a second MusicServiceAdapter alongside Apple Music. The portal auth/connection flow already works. This plan covers the MCP server implementation: Spotify API client, adapter, token management changes, and **provider-aware tool registration** that exposes each service's actual capabilities — not a lowest-common-denominator set.

## Key Insight: Provider-Specific Tool Sets

Spotify and Apple Music have fundamentally different capabilities. Rather than hiding Spotify's strengths behind Apple Music's limitations, we register tools based on what each connected provider actually supports:

### Shared Tools (registered for either provider)
| Tool | Notes |
|------|-------|
| `search_catalog` | Both support catalog search |
| `list_playlists` | Both support listing |
| `get_playlist_tracks` | Both support reading tracks |
| `create_playlist` | Both support creation — but descriptions differ (Apple Music warns irreversible) |
| `add_tracks` | Both support adding — but descriptions differ (Apple Music warns append-only) |
| `get_recently_played` | Both support history |
| `get_library_songs` | Both support library reads |
| `add_to_library` | Both support adding to library |

### Spotify-Only Tools (registered only when Spotify is connected)
| Tool | Spotify API | Why not Apple Music |
|------|-------------|---------------------|
| `remove_playlist` | `DELETE /playlists/{id}/followers` (unfollow) | No delete endpoint exists |
| `remove_tracks_from_playlist` | `DELETE /playlists/{id}/tracks` | No atomic removal — must rewrite entire list |
| `reorder_playlist_tracks` | `PUT /playlists/{id}/tracks` with range params | No reorder — must rewrite entire list |
| `update_playlist` | `PUT /playlists/{id}` (name, description, public) | Limited/partial support only |
| `remove_from_library` | `DELETE /me/tracks`, `DELETE /me/albums` | Supported but not currently exposed |
| `get_top_items` | `GET /me/top/artists`, `GET /me/top/tracks` | No analytics API |

### Future Consideration: Spotify Playback Tools
Spotify supports full remote playback control (play, pause, skip, queue, volume, seek, device transfer). Apple Music has zero server-side playback control. These could be powerful MCP tools but are deferred to a separate feature to keep this scope manageable. Requires Spotify Premium.

### Multi-Service Prefixing
When both services are connected:
- Shared tools get prefixed: `apple_music_search_catalog`, `spotify_search_catalog`
- Spotify-only tools get prefixed: `spotify_remove_playlist`, `spotify_get_top_items`
- Each service's shared tool descriptions reflect that service's actual behavior (e.g., Apple Music `create_playlist` warns about irreversibility; Spotify's does not)

When only one service is connected:
- All tools are unprefixed for simplicity

## Implementation Steps

### Phase 1: Token & Type Foundation
- [ ] Step 1: Update `token-manager.ts` — replace `UserTokens` with discriminated union (`AppleMusicTokens | SpotifyTokens`), update `ConnectedService` to carry `ServiceTokens`, add migration compat for existing rows without `kind`
- [ ] Step 2: Update `errors.ts` — add `SpotifyTokenExpiredError extends TokenExpiredError`
- [ ] Step 3: Update `services/types.ts` — extend `MusicServiceAdapter` interface: add optional methods for Spotify-only operations (`removePlaylist`, `removeTracksFromPlaylist`, `reorderPlaylistTracks`, `updatePlaylist`, `removeFromLibrary`, `getTopItems`), add `supportedCapabilities` property so tool registration can query what the adapter supports
- [ ] Step 4: Update `AppleMusicAdapter` — narrow tokens to `AppleMusicTokens` via `kind` discriminant, return `supportedCapabilities` (no extra capabilities beyond base)

### Phase 2: Spotify Adapter
- [ ] Step 5: Create `services/spotify/api-client.ts` — `spotifyFetch()` with retry/backoff, 401→SpotifyTokenExpiredError, 429→RateLimitError
- [ ] Step 6: Create `services/spotify/adapter.ts` — `SpotifyAdapter implements MusicServiceAdapter` with all 8 base operations + 6 Spotify-only operations, `supportedCapabilities` includes all extras

### Phase 3: Provider-Aware Tool Registration
- [ ] Step 7: Update `mcp-server.ts` — widen `ServiceEntry.adapter` to `MusicServiceAdapter`, split registration into `registerBaseTools(server, adapter, tokens, prefix)` + `registerSpotifyExtraTools(server, adapter, tokens, prefix)`, use `adapter.supportedCapabilities` to conditionally register extra tools
- [ ] Step 8: Update `index.ts` — construct `SpotifyAdapter` when Spotify is connected, add token refresh check (Clerk backend SDK), invalidate `serviceCache` after refresh
- [ ] Step 9: Provider-specific tool descriptions — Apple Music shared tools include irreversibility warnings, Spotify shared tools have accurate (non-warning) descriptions

### Phase 4: API Token Flow Updates
- [ ] Step 10: Update `packages/api/src/routes/services.ts` and `sync-from-clerk.ts` — write full `SpotifyTokens` shape (`kind`, `accessToken`, `refreshToken`, `expiresAt`) instead of stub `{ developerToken: '', userToken: token }`

### Phase 5: Testing & Verification
- [ ] Step 11: Build all packages (`pnpm -r build`) and run existing tests (`pnpm -r test`)
- [ ] Step 12: End-to-end verification — connect Spotify via portal, verify correct tools register per provider, test shared + Spotify-only operations
- [ ] Step 13: Multi-service test — connect both providers, verify prefixed tools, verify Spotify-only tools appear with prefix, verify Apple Music tools don't include Spotify extras

## Technical Decisions

1. **Discriminated union for tokens** — `ServiceTokens = AppleMusicTokens | SpotifyTokens` with `kind` discriminant. Existing rows without `kind` auto-migrate on read.
2. **Lazy token refresh** — Spotify access tokens refreshed in `index.ts` via Clerk backend SDK when within 60s of expiry. No separate Lambda/scheduler.
3. **Provider-aware tool registration** — each service exposes its actual capabilities. Spotify-only tools are only registered when Spotify is connected. Shared tools get provider-specific descriptions.
4. **Capability-based registration** — adapters declare `supportedCapabilities` so tool registration is driven by what the adapter can do, not hardcoded service checks. This makes adding future services (Tidal, YouTube Music) straightforward.
5. **Service-prefixed tools when both connected** — `spotify_*`, `apple_music_*` when both services present. Unprefixed when single service for backward compat.
6. **No new infrastructure** — Same DynamoDB table, KMS key, and encryption path. Only Clerk OAuth scope configuration needed externally.
7. **Playback control deferred** — Spotify playback tools (play, pause, skip, queue) are high value but separate scope. Tracked as a future feature.

## Testing Strategy

- Unit tests for `SpotifyAdapter` methods (mock `spotifyFetch`)
- Unit tests for token type narrowing and migration compat
- Unit tests for capability-based tool registration (verify correct tools registered per provider combo)
- Integration test: build all packages, verify no type errors
- Manual E2E: connect Spotify, verify Spotify-only tools present; connect both, verify prefixed tools + extras

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Spotify token refresh fails mid-request | Catch `SpotifyTokenExpiredError`, return actionable error with portal URL |
| Existing Apple Music rows lack `kind` field | Migration compat: treat missing `kind` as `apple_music` |
| Clerk doesn't expose refresh token directly | Use Clerk's `getUserOauthAccessToken` which handles refresh internally |
| Spotify rate limits more aggressive than Apple Music | Same exponential backoff + `Retry-After` header handling |
| Tool count explosion with both services | Prefixed names keep it clear; LLM context stays clean with accurate descriptions |
| Spotify "delete" is really "unfollow" | Tool named `remove_playlist` (not `delete_playlist`), description explains behavior |

## Design Reference

See `docs/features/spotify-support/api-design.md` for full API contracts, endpoint mappings, and data flow diagrams.
