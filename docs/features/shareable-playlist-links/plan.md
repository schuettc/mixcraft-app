---
started: 2026-03-26
---

# Implementation Plan: Shareable Playlist Links

## Overview

Enable users to share public links that show a playlist alongside the conversation context that created it. Shares are snapshots — immutable after creation, no auth required to view. Users manage (list/delete) shares from the Dashboard or via MCP tools.

## Architecture

```
Claude Code ─→ MCP Tool (share_playlist) ─→ Portal API (POST /api/shared-playlists) ─→ DynamoDB
Browser ─→ mixcraft.app/share/:id ─→ Portal API (GET /api/shared-playlists/:id) ─→ DynamoDB
Dashboard ─→ Portal API (GET/DELETE /api/shared-playlists) ─→ DynamoDB
```

## Data Model

**DynamoDB Table: `SharedPlaylists`**
- PK: `shareId` (ULID, 26 chars, URL-safe)
- Attributes: `userId`, `title`, `service`, `tracks` (inline list), `conversationSummary` (max 2000 chars), `trackCount`, `createdAt`, `isDeleted`
- GSI `UserIdCreatedAtIndex`: PK=`userId`, SK=`createdAt` — for listing user's shares
- No TTL in v1 — shares persist until explicitly deleted

**TrackRecord**: `{ title, artist, album?, duration? }` — no service catalog IDs

## API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/shared-playlists` | Clerk or API key | Create share |
| GET | `/api/shared-playlists/:shareId` | None (public) | View share |
| GET | `/api/shared-playlists` | Clerk | List user's shares |
| DELETE | `/api/shared-playlists/:shareId` | Clerk | Delete share (soft delete) |

Public GET never returns `userId`. Soft delete via `isDeleted` flag.

## MCP Tools

Three tools registered unconditionally (not service-prefixed):
- `share_playlist` — title, service, tracks[], conversationSummary?, returns shareUrl
- `list_shared_playlists` — returns user's active shares
- `delete_shared_playlist` — soft-deletes by shareId

## Frontend

- **Public route** `/share/:id` — outside Clerk auth wrapper, no Clerk hooks
- **SharePage** fetches via plain `fetch()` (no `useApi`), renders: PlaylistHero, ConversationFlow (chat bubbles), TrackList
- **SharedPlaylistsSection** in Dashboard — table of shares with copy URL + delete buttons
- Follows existing Studio Console dark theme patterns

## Implementation Steps

- [ ] Step 1: Add `SharedPlaylists` DynamoDB table to `packages/infra/src/constructs/database.ts` with GSI, wire to API and MCP Lambdas in the stack
- [ ] Step 2: Create `packages/api/src/routes/shared-playlists.ts` with create, get (public), list, and delete handlers
- [ ] Step 3: Register shared-playlist routes in `packages/api/src/index.ts` — public GET before auth middleware, authenticated routes after
- [ ] Step 4: Add unit tests for shared-playlist API routes
- [ ] Step 5: Add `share_playlist`, `list_shared_playlists`, `delete_shared_playlist` MCP tools in `packages/mcp-server/src/mcp-server.ts`
- [ ] Step 6: Add public share page — `SharePage.tsx`, `useShareData.ts` hook, conversation/track display components
- [ ] Step 7: Add `/share/:id` route to `App.tsx` outside auth wrapper
- [ ] Step 8: Add `SharedPlaylistsSection` to Dashboard with list/delete management
- [ ] Step 9: Build and test all packages

## Technical Decisions

- **Snapshot model**: Tracks captured at share time — no live API calls on public views, no token exposure
- **ULID for shareIds**: Time-sortable, URL-safe, 26 chars, unguessable
- **Inline tracks**: Up to 500 tracks at ~100 bytes each = ~50KB, well within DynamoDB's 400KB limit
- **Soft delete**: `isDeleted` flag for immediate logical deletion; avoids hard-delete complexity
- **No service catalog IDs stored**: Only human-readable track info (title/artist/album/duration)
- **Public GET registered before auth middleware**: Matches existing pattern (webhook, Spotify callback)
- **conversationSummary as plain text**: Claude provides a summary at tool invocation time — MCP server does not record conversation turns

## Privacy Safeguards

- `userId` stored for ownership but NEVER returned in public responses
- No emails, usernames, API keys, or tokens in share data
- API validates max 2000 char summary, max 500 tracks
- Share page renders no Clerk hooks, no analytics tracking
- Public page shows only: title, service badge, tracks, conversation summary, creation date

## Testing Strategy

- Unit tests for all API route handlers (create, get, list, delete, ownership checks, 404 on deleted)
- Unit tests for input validation (max lengths, required fields)
- MCP tool registration verification
- Frontend: manual verification of public share page rendering and Dashboard management

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| PII in conversation summary | Claude controls what goes in; API enforces max length; backend never stores usernames/emails |
| Share enumeration | ULIDs have 80+ bits of randomness — infeasible to guess |
| Storage growth | 50 shares/user limit (enforced in create handler) |
| SPA routing for /share/:id | CloudFront already returns index.html for unknown paths |
