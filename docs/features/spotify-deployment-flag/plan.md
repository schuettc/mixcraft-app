---
started: 2026-04-29
---

# Implementation Plan: Spotify Deployment Flag

## Overview

Gate Spotify integration behind a single deploy-time flag (`enableSpotify`)
that propagates from CDK context through to Lambda env vars and a runtime-
loaded `config.json` baked into S3 by the web construct. Hosted `mixcraft.app`
ships with the flag off (Apple Music only); self-hosters flip it on after
registering their own Spotify dev app and adding their friends to its
allowlist.

All Spotify code stays in the repo, compiled in, and unit-testable. Only the
runtime activation (route handlers, adapter registration, UI cards, secret
IAM grants) is gated.

## Implementation Steps

### Infra wiring (the spine)

- [x] Step 1: Add `enableSpotify` CDK context parsing in
  `packages/infra/src/index.ts` (default `false`); pass through
  `MixcraftStackProps`.
- [x] Step 2: Thread `enableSpotify: boolean` prop through
  `MixcraftStackProps` in `packages/infra/src/stacks/mixcraft-stack.ts`.
- [x] Step 3: In `SecurityConstruct` (`packages/infra/src/constructs/security.ts`),
  make Spotify secret lookups conditional. When `enableSpotify` is false,
  skip `Secret.fromSecretNameV2` for the two Spotify secrets and expose them
  as `undefined` on the construct (type the public fields as
  `secretsmanager.ISecret | undefined`).
- [x] Step 4: In `McpApiConstruct` and `PortalApiConstruct`, accept
  `enableSpotify: boolean` and `spotifyClientIdSecret?: ISecret` /
  `spotifyClientSecretSecret?: ISecret`. Set `ENABLE_SPOTIFY: String(enableSpotify)`
  on the Lambda environment. Conditionally call `grantRead` only when the
  secrets are defined. Use spread syntax to conditionally include the
  `SPOTIFY_*_SECRET_NAME` env vars only when both `enableSpotify` is true
  AND the secrets are defined — i.e.
  `...(enableSpotify && props.spotifyClientIdSecret ? { SPOTIFY_CLIENT_ID_SECRET_NAME: props.spotifyClientIdSecret.secretName } : {})`.
  Accessing `.secretName` on `undefined` would crash CDK synth.
- [x] Step 5: Update `PortalConstruct.deployContent()` signature in
  `packages/infra/src/constructs/web.ts` to accept `enableSpotify: boolean`
  and include it in the `Source.jsonData('config.json', { ... })` payload.
- [x] Step 6: In `MixcraftStack`, wire the flag through to all three
  constructs and to `portal.deployContent()`.
- [x] Step 6b: In `PortalConstruct` (`packages/infra/src/constructs/web.ts`),
  conditionally include Spotify domains in the CSP `connect-src`,
  `img-src`, and `frame-src` headers only when `enableSpotify` is true.
  Tightens the security posture of the hosted Apple-only deployment.

### Server-side gating

- [x] Step 7: In `packages/mcp-server/src/index.ts`, read
  `const ENABLE_SPOTIFY = process.env.ENABLE_SPOTIFY === 'true'`. Wrap the
  two Spotify branches (clerk_oauth and stored-tokens) in `if (ENABLE_SPOTIFY)`.
  When off, skip Spotify adapter registration entirely so no Spotify tools
  appear in the MCP tool list.
- [x] Step 8: In `packages/api/src/index.ts`, read the same env flag. Guard
  the two routes `/api/spotify/auth-url` and `/api/spotify/callback` —
  when off, return `404 Not found` (consistent with the early-reject pattern
  for non-`/api/` paths).
- [x] Step 9: In `packages/api/src/routes/services.ts`, when `connectService`
  receives `provider: 'spotify'` while flag is off, return a 400 with
  `{ error: 'Spotify is not enabled on this deployment' }`. Apply the same
  guard to `disconnectService` and `getServiceStatus` for `spotify`. In
  `getAllServicesStatus`, when the flag is off, omit the `spotify` entry
  (or report `connected: false`) so the portal's `useServices` hook never
  shows a stale "Spotify connected" badge after a flag flip — otherwise
  Setup's "Step 1 complete" indicator would be wrong while no Spotify
  tools are actually exposed.

### Web (S3/CloudFront) gating

- [x] Step 10: Extend `AppConfig` in `packages/web/src/config.ts` with
  `enableSpotify: boolean`.
- [x] Step 11: In `packages/web/src/pages/Setup.tsx`, render the Spotify
  card and `useSpotifyConnect`-driven UI only when `config.enableSpotify`.
  Adjust the `hasAnyConnection` calculation so it only counts Spotify when
  the flag is on — a stale "spotify connected" entry from before a flag
  flip must not satisfy "Step 1: Connect a Music Service".
- [x] Step 12: In `packages/web/src/pages/Dashboard.tsx`, hide the
  Spotify connection card and skip the Spotify-related copy when the flag
  is off. Keep the share-history "Spotify" label rendering intact (legacy
  shares may still reference it).
- [x] Step 13: In `packages/web/src/hooks/useServiceSync.ts` (and any other
  hook that polls Spotify connect status), short-circuit when the flag is
  off so we don't spam the API with requests for a disabled provider.

### Documentation

- [x] Step 14: Update root `README.md` — under "What is MixCraft", state
  that the hosted deployment supports Apple Music; Spotify support is
  available for self-hosted forks. Add a "Self-hosting" section pointing
  to `docs/SELF-HOSTING.md`.
- [x] Step 15: Create `docs/SELF-HOSTING.md` covering: prerequisites
  (AWS account, domain in Route 53, Clerk account), Spotify dev app
  registration and allowlist management, secret seeding in Secrets Manager,
  deploy command with `-c enableSpotify=true`, and how to switch the flag
  off later.
- [x] Step 16: Update `packages/mcp-proxy/README.md` and
  `packages/plugin/README.md` to clarify that Spotify capability depends
  on the upstream deployment's `enableSpotify` flag.
- [x] Step 17: Update `docs/PROJECT-STATUS.md` to note the deployment-flag
  architecture and current hosted-vs-self-host capability matrix.
- [x] Step 18: Add a short note to `CLAUDE.md` under the Multi-Service
  Architecture section explaining the `ENABLE_SPOTIFY` env var contract
  for future contributors.

### Tests

- [x] Step 19: In `packages/api/src/routes/services.test.ts`, add cases
  asserting that `connectService('spotify')` returns 400 when
  `ENABLE_SPOTIFY=false` and works as today when `ENABLE_SPOTIFY=true`.
- [x] Step 20: In `packages/mcp-server/src/index.test.ts` (or
  `mcp-server.test.ts`), add a case that the Spotify tools are not
  registered when `ENABLE_SPOTIFY=false`.
- [x] Step 21: Verify `pnpm -r build` and `pnpm -r test` both pass with
  the flag off and on.

## Technical Decisions

**Single flag, three deliveries.** One CDK context input drives:
(a) Lambda env var, (b) IAM grants, (c) S3-baked `config.json`. No
client-side env var, no Vite rebuild, no CloudFront cache invalidation
beyond what `BucketDeployment` already handles.

**Default off.** The hosted deployment is the most-trafficked path; making
the safer mode the default means a forgotten `-c enableSpotify=true` on
the production deploy degrades gracefully (Apple still works) rather than
exploding (missing Spotify secrets).

**Code stays compiled in.** We don't tree-shake the Spotify adapter or
delete the OAuth routes — only the runtime registration is gated.
This keeps the diff small, preserves type safety, and means self-hosters
get the feature by flipping a single context value.

**404, not 503, on disabled OAuth routes.** Matches the existing scanner-
rejection pattern in `packages/api/src/index.ts` and avoids leaking the
flag's existence to unauthenticated callers.

**`SecurityConstruct` exposes `ISecret | undefined`.** Cleaner than
constructing a placeholder secret. Forces downstream constructs to handle
the optional explicitly, which is the right behavior.

## Testing Strategy

- Unit: existing `services.test.ts` and mcp-server tests, with
  `process.env.ENABLE_SPOTIFY` toggled per case.
- Build: `pnpm -r build` confirms TypeScript stays clean with the
  optional secret types.
- Manual smoke (post-deploy): hit `https://mcp.mixcraft.app/mcp` from an
  Apple-only user and confirm only Apple tools appear; load
  `https://mixcraft.app/setup` and confirm the Spotify card is hidden;
  curl `https://api.mixcraft.app/api/spotify/auth-url` and confirm 404.
- Self-host smoke (deferred to docs verification, not blocking): deploy
  with `-c enableSpotify=true` to a side stack and confirm Spotify card
  appears and OAuth redirect works.

## Risks & Mitigations

- **Risk:** Existing connected Spotify users on hosted `mixcraft.app` lose
  access silently after deploy.
  **Mitigation:** Realistically there are zero such users (the public
  Spotify app is allowlist-gated to a handful of dev accounts). For
  any allowlisted users, communicate before deploy. Their stored tokens
  in DynamoDB stay intact and re-activate if the flag is ever flipped on.

- **Risk:** Drift between server gating and UI gating — UI shows a
  Connect button but the API returns 404.
  **Mitigation:** Both read from the same `config.json` / env var that
  comes from the same CDK context value. Single source of truth.

- **Risk:** A future Spotify-related code change breaks the Apple-only
  build because tests only cover the on-path.
  **Mitigation:** Add explicit "flag off" test cases in Step 19/20 so CI
  exercises both modes.

- **Risk:** Secrets Manager grant-skip leaves dangling references if a
  reviewer adds a new Spotify-using Lambda later.
  **Mitigation:** The optional `ISecret | undefined` typing forces a
  compile error in any new construct that tries to grant against an
  undefined secret without checking — fail-loud is the goal.

## Progress Log

- 2026-04-29: Addressed implementation review feedback.
  - Restored `getAllServicesStatus` to always include `spotify` in the
    response shape (with `connected: false` when flag is off) so the
    portal's `services.spotify.connected` access doesn't crash. The
    plan-review concern (no stale "connected" badge) is preserved
    because the value is `false`; the portal also gates the card render
    on `enableSpotify` independently.
  - Added defensive `mergeStatus()` in `useServices` so any future
    contract drift falls back to `DEFAULT_STATUS` instead of crashing.
  - Added optional chaining on `services.spotify?.connected` as
    belt-and-suspenders.
  - Steps 17 (`docs/PROJECT-STATUS.md`) and 18 (`CLAUDE.md`) — both
    files are gitignored in this repo (lines 8–9 of `.gitignore`), so
    edits don't propagate via git. The equivalent public-facing
    contract for the `ENABLE_SPOTIFY` env var and `enableSpotify` CDK
    context lives in `docs/SELF-HOSTING.md`, which is the right home
    for it. Local CLAUDE.md updated for the maintainer's own session
    context but not committed.

- 2026-04-29: All 22 steps implemented in a single pass.
  - Infra: enableSpotify CDK context wired through MixcraftStack →
    SecurityConstruct (optional ISecret), McpApiConstruct, PortalApiConstruct
    (conditional env var spread + grant), and PortalConstruct (CSP gating
    + config.json bake).
  - Server: mcp-server gates Spotify adapter registration via
    `isSpotifyEnabled()`; api gates `/api/spotify/*` routes (404 when off);
    services.ts rejects connect/disconnect/status for spotify and omits
    stale spotify entries from getAllServicesStatus.
  - Web: useAppConfig hook reads enableSpotify from runtime config.json;
    Setup.tsx and Dashboard.tsx hide Spotify card when off; useServiceSync
    skips oauth_spotify external accounts when off; hasAnyConnection only
    counts spotify when flag is on.
  - Docs: README pivots to Apple-only hosted positioning; new
    docs/SELF-HOSTING.md walks through Spotify dev app + secrets +
    `cdk deploy -c enableSpotify=true`; mcp-proxy and plugin READMEs
    updated; CLAUDE.md gains a "Spotify Deployment Flag" section.
  - Tests: 6 new flag-off cases in services.test.ts (all pass; 136 total),
    3 new ENABLE_SPOTIFY cases in mcp-server index.test.ts (all pass; 120
    total). `pnpm -r build` and `pnpm -r test` both green.
