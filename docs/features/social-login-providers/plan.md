---
started: 2026-03-25
---

# Implementation Plan: Spotify & Apple Music Social Login

## Overview

Add Spotify and Apple Music as social login providers via Clerk, and auto-connect the matching music service when a user signs in with a provider. Login (identity) and connection (music service) remain separate concepts — an Apple login user can also connect Spotify, and vice versa. This feature focuses on auth + token sync; full Spotify MCP tools are tracked in `spotify-support`.

## Key Design Decisions

1. **Login vs Connection separation**: Clerk social login is for identity. Music service connection is for MCP tool access. A user can log in with email and connect both services, or log in with Apple and connect Spotify too.
2. **Auto-connect on social login**: When a user signs in via Spotify or Apple, we attempt to sync their OAuth token to the `UserMusicTokensTable` automatically — skipping the manual connection step for that provider.
3. **Token sync via Clerk webhook**: Extend the existing `user.created` webhook handler (or add `session.created`) to detect social login and sync OAuth tokens. Alternatively, use a frontend-initiated sync after sign-in.
4. **Service-agnostic token storage**: Generalize the current Apple Music-specific routes into a provider-agnostic pattern (`/api/services/{provider}/connect`) to make the upcoming `spotify-support` feature easier.
5. **Existing MusicKit flow preserved**: Users who connected Apple Music via MusicKit keep their tokens. The new flow is additive.

## Implementation Steps

### Phase 1: Clerk Configuration & Infrastructure
- [ ] Step 1: Configure Spotify OAuth provider in Clerk dashboard (client ID, secret, scopes)
- [ ] Step 2: Configure Apple OAuth provider in Clerk dashboard (if not already — separate from MusicKit)
- [ ] Step 3: Add Spotify OAuth scopes needed for future MCP tools (user-library-read, playlist-read-private, playlist-modify-public, playlist-modify-private, user-read-recently-played)
- [ ] Step 4: Update CSP headers in `packages/infra/src/constructs/web.ts` for Spotify domains (accounts.spotify.com, *.scdn.co)
- [ ] Step 5: Add any new secrets to `packages/infra/src/index.ts` if Spotify requires server-side credentials beyond Clerk

### Phase 2: Backend — Generalized Service Connection
- [ ] Step 6: Create `packages/api/src/routes/services.ts` with provider-agnostic endpoints:
  - `POST /api/services/{provider}/connect` — store encrypted token
  - `POST /api/services/{provider}/disconnect` — remove token
  - `GET /api/services/{provider}/status` — check connection
  - `GET /api/services/status` — all services connection status in one call
- [ ] Step 7: Keep existing `/api/apple-music/*` routes as aliases (backward compat for MusicKit flow) but have them delegate to the new generic handlers
- [ ] Step 8: Add Clerk OAuth token retrieval utility — `getOAuthTokenForProvider(userId, provider)` using `@clerk/backend` to fetch stored OAuth tokens from Clerk
- [ ] Step 9: Create `POST /api/services/sync-from-clerk` endpoint that:
  1. Accepts `{ provider: string }` body
  2. Fetches the OAuth token from Clerk for the authenticated user
  3. Encrypts and stores it in `UserMusicTokensTable`
  4. Returns connection status

### Phase 3: Frontend — Social Login UI
- [ ] Step 10: Update Clerk `<SignIn>` and `<SignUp>` component appearance config to show Spotify and Apple buttons prominently
- [ ] Step 11: Create `packages/web/src/hooks/useServiceSync.ts` — after sign-in, detect social provider and auto-call `/api/services/sync-from-clerk` to auto-connect
- [ ] Step 12: Update `packages/web/src/pages/Setup.tsx` to show connection cards for both Apple Music and Spotify, with status indicators
- [ ] Step 13: Add "Connect with Spotify" button on Setup page (manual connect path for users who didn't sign in with Spotify)
- [ ] Step 14: Add "Connect with Apple Music via Clerk" option alongside existing MusicKit flow on Setup page

### Phase 4: MCP Server Awareness
- [ ] Step 15: Update `packages/mcp-server/src/shared/token-manager.ts` to recognize `spotify` as a valid service type when fetching tokens
- [ ] Step 16: Ensure the MCP server's conditional tool registration checks for `spotify` service presence (groundwork for `spotify-support` feature)

### Phase 5: Testing & Validation
- [ ] Step 17: Add unit tests for generalized service routes
- [ ] Step 18: Add unit tests for Clerk OAuth token sync logic
- [ ] Step 19: End-to-end test: sign in with Spotify → verify token stored → verify connection status
- [ ] Step 20: End-to-end test: sign in with Apple → verify auto-connect → verify MCP server sees connection
- [ ] Step 21: Test cross-provider: Apple login user connects Spotify manually, and vice versa

## Technical Decisions

- **Frontend-initiated sync over webhook**: Using a frontend call to `/api/services/sync-from-clerk` after sign-in is more reliable than webhooks for token sync — webhooks may fire before the OAuth token is fully available in Clerk, and we need the user's session context.
- **Provider-agnostic routes**: Creating `/api/services/{provider}/*` now avoids duplicating the Apple Music route pattern for Spotify. The existing `/api/apple-music/*` routes stay as aliases.
- **Clerk as OAuth token store**: Clerk manages token refresh for social providers. We fetch from Clerk and encrypt into DynamoDB so the MCP server (which uses API keys, not Clerk) can access tokens independently.
- **Generous Spotify scopes upfront**: Request all scopes the `spotify-support` feature will need now, so users don't need to re-authorize later.

## Testing Strategy

- Unit tests for new API routes and token sync logic
- Integration tests for DynamoDB token storage (both providers)
- Manual E2E tests for social login flows (Clerk handles the OAuth UI)
- Verify MCP server can read Spotify tokens from DynamoDB (even if no Spotify tools yet)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Clerk OAuth token expiry | Clerk auto-refreshes tokens; re-sync on each session if needed |
| Apple social login ≠ Apple Music authorization | Apple social login may not grant music scopes — verify in Clerk config and fall back to MusicKit if needed |
| Spotify scope changes breaking future tools | Request generous scopes upfront; document required scopes in `spotify-support` feature |
| Existing Apple Music connections disrupted | MusicKit flow preserved; new flow is additive only |
| CSP blocking Spotify domains | Add Spotify domains to CSP in infra before frontend work |

## Dependencies

- Clerk dashboard access for OAuth provider configuration
- Spotify Developer App credentials (client ID + secret)
- Apple Developer account OAuth configuration (separate from MusicKit)

## Relationship to Other Features

- **`spotify-support`**: This feature provides the auth/connection layer. `spotify-support` builds MCP tools on top of the Spotify tokens stored here.
- **`shareable-playlist-links`**: No direct dependency, but multi-provider support enriches shareable content.
