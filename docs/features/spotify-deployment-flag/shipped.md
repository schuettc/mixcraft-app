---
shipped: 2026-04-29
---

# Shipped: Spotify Deployment Flag

## Summary

Spotify integration is now gated behind a single deploy-time flag
(`enableSpotify`). Hosted `mixcraft.app` deploys with the flag off — Apple
Music only — because Spotify's developer program restricts apps to a
manually-managed allowlist that cannot be expanded for public distribution.
All Spotify code stays compiled in; self-hosters flip the flag with one CDK
context value (`-c enableSpotify=true`) after registering their own Spotify
dev app.

## Key Changes

- **CDK context → three deliveries.** A single `enableSpotify` context value
  (default `false`) propagates through `MixcraftStackProps` to: (a) Lambda
  env var `ENABLE_SPOTIFY` on both MCP server and portal API, (b) IAM grants
  on the Spotify Secrets Manager entries (skipped when off — secrets don't
  need to exist), (c) runtime `config.json` baked into S3 by
  `PortalConstruct.deployContent()`.
- **Optional secrets shape.** `SecurityConstruct` now exposes
  `spotifyClientIdSecret` and `spotifyClientSecretSecret` as
  `ISecret | undefined`. Downstream constructs use spread syntax to avoid
  CDK synth crashes on undefined `secretName` access.
- **CSP tightening.** When the flag is off, the hosted deploy's CSP omits
  Spotify origins (`accounts.spotify.com`, `*.scdn.co`) for a tighter
  security posture.
- **MCP server gating.** `mcp-server/src/index.ts` skips Spotify adapter
  registration via `isSpotifyEnabled()`, so no Spotify tools appear in the
  MCP tool list when off.
- **Portal API gating.** 404 on `/api/spotify/auth-url` and
  `/api/spotify/callback` when off (matches the existing scanner-rejection
  pattern). `services.ts` rejects `provider: spotify` for connect/disconnect
  /status. `getAllServicesStatus` reports `spotify: { connected: false }`
  when off, so the portal's `services.spotify.connected` access is safe and
  no stale "connected" badge surfaces after a flag flip.
- **Web gating.** New `useAppConfig` hook reads `enableSpotify` from the
  runtime `config.json`. `Setup.tsx` and `Dashboard.tsx` hide the Spotify
  card when off; copy and `hasAnyConnection` calculations adjust. A
  defensive `mergeStatus()` in `useServices` falls back to `DEFAULT_STATUS`
  if the API contract ever drifts.
- **`useServiceSync` short-circuit.** When the flag is off, the hook skips
  `oauth_spotify` external accounts so we don't spam the API with rejected
  sync attempts that would surface as a confusing failure banner.
- **Documentation.** README pivots to Apple-only hosted positioning; new
  `docs/SELF-HOSTING.md` walks through Spotify dev app registration,
  allowlist, secret seeding, and the deploy command. `mcp-proxy` and
  `plugin` READMEs clarify hosted vs self-hosted capability.

## Files Changed

Infrastructure:
- `packages/infra/src/index.ts` — read `enableSpotify` CDK context
- `packages/infra/src/stacks/mixcraft-stack.ts` — thread flag through
- `packages/infra/src/constructs/security.ts` — optional Spotify secrets
- `packages/infra/src/constructs/mcp-api.ts` — conditional env + grants
- `packages/infra/src/constructs/api.ts` — conditional env + grants
- `packages/infra/src/constructs/web.ts` — bake flag into config.json,
  conditional CSP

Server:
- `packages/mcp-server/src/index.ts` — `isSpotifyEnabled()` gate
- `packages/api/src/index.ts` — gate Spotify OAuth routes
- `packages/api/src/routes/services.ts` — flag-aware connect/status

Web:
- `packages/web/src/config.ts` — `enableSpotify: boolean` in `AppConfig`
- `packages/web/src/hooks/useAppConfig.ts` — new hook (created)
- `packages/web/src/hooks/useServices.ts` — defensive `mergeStatus`,
  optional chaining
- `packages/web/src/hooks/useServiceSync.ts` — skip oauth_spotify when off
- `packages/web/src/pages/Setup.tsx` — gate Spotify card and copy
- `packages/web/src/pages/Dashboard.tsx` — gate Spotify card

Docs:
- `README.md` — Apple-only positioning, self-hosting pointer
- `docs/SELF-HOSTING.md` — full self-host walkthrough (created)
- `packages/mcp-proxy/README.md`, `packages/plugin/README.md` — capability
  notes

Tests:
- `packages/api/src/routes/services.test.ts` — 6 new flag-off cases
- `packages/mcp-server/src/index.test.ts` — 3 new flag-toggle cases

CI infrastructure (landed alongside this feature):
- `.github/workflows/feature-review.yml` — `GEMINI_CLI_TRUST_WORKSPACE` env
  var so the Gemini reviewer runs in headless mode

## Testing

- `pnpm -r build` green across all 7 packages.
- `pnpm -r test` green: 304 tests across 28 files including 9 new explicit
  flag-toggle cases.
- Plan reviewed by Gemini (`CONDITIONAL PASS`); two blocking findings folded
  into the plan and addressed in the implementation:
  1. `McpApiConstruct`/`PortalApiConstruct` use spread syntax for
     `SPOTIFY_*_SECRET_NAME` env vars to avoid `undefined.secretName` synth
     crashes.
  2. `getAllServicesStatus` no longer leaves stale `spotify: connected: true`
     entries surfacing after a flag flip.
- Implementation reviewed by Gemini (`CONDITIONAL PASS` → `PASS` after
  follow-up): a frontend crash from omitting the spotify key entirely was
  caught and fixed by always returning `connected: false`. Defensive merge
  + optional chaining added as belt-and-suspenders.

## Notes

- **Hosted `mixcraft.app` deploy still needs to actually run** with the
  default flag value to switch off Spotify in production. The next
  `cdk deploy --all` (without `-c enableSpotify=true`) flips the
  production stack.
- **Stale Spotify tokens** for the small set of allowlisted users who
  connected before this change stay encrypted in DynamoDB. They're ignored
  while the flag is off. If we ever flip the flag back on, they re-activate.
  Cleanup is not blocking and could be a separate backlog item if it ever
  matters.
- **`docs/PROJECT-STATUS.md` and `CLAUDE.md` are gitignored** in this repo,
  so the deployment-flag contract for future contributors lives in
  `docs/SELF-HOSTING.md` (which is the right home for it). Plan steps 17/18
  satisfied via that route.
- **Spotify OAuth callback URL.** Self-hosters must register their dev app
  callback as `https://api.<their-domain>/api/spotify/callback` and add
  their friends to the app's "Users and Access" allowlist (capped at 25 by
  Spotify for non-extended-quota apps). All documented in SELF-HOSTING.md.
