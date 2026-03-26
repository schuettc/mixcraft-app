# CLAUDE.md - Project Conventions

## Overview

MixCraft - a hosted MCP server that acts as an authenticated proxy
between Claude Code and music services (Apple Music and Spotify).

## Workspace

- pnpm workspace monorepo
- Node 20+
- TypeScript strict mode everywhere

## Style

- 2-space indentation
- Single quotes
- Semicolons

## Build & Test

- Build: `pnpm -r build`
- Test: `pnpm -r test`
- Each package builds independently

## CI/CD

- **CI**: Runs on push to main and PRs — lints and builds all packages (`.github/workflows/ci.yml`)
- **Publish**: Triggered by GitHub Release — publishes `packages/mcp-proxy` to npm with provenance (`.github/workflows/publish.yml`)
- To release a new CLI version: bump version in `packages/mcp-proxy/package.json`, push, then create a GitHub Release
- Do NOT run `npm publish` locally — let the CI pipeline handle it

## Packages

- `packages/mcp-proxy` - CLI (`npx mixcraft-app`) - stdio-to-HTTP MCP proxy
- `packages/mcp-server` - Hosted MCP server (Lambda)
- `packages/web` - Web portal (React + Vite) for user self-service
- `packages/api` - Portal backend (Lambda)
- `packages/infra` - AWS CDK infrastructure
- `packages/plugin` - Claude Code plugin

## Infrastructure

- AWS CDK for infrastructure
- Secrets never in code or environment variables at rest
- API key format: `mx_` + 32 hex chars, stored as SHA-256 hash
- Spotify tokens auto-refresh via Clerk backend SDK (proactive + reactive on 401)
- Domains: mixcraft.app (portal), api.mixcraft.app (portal API), mcp.mixcraft.app (MCP server)
- AWS credentials: `AWS_PROFILE=playlists aws sso login`
- Deploy: `cd packages/infra && AWS_PROFILE=playlists npx cdk deploy --all`

## MCP SDK

- Use `McpServer` (high-level, recommended), NOT `Server` (deprecated)
- `McpServer.tool()` requires Zod schemas, not plain JSON Schema objects
- SDK version: ^1.0.0

## Multi-Service Architecture

- `MusicServiceAdapter` interface in `services/types.ts` — both `AppleMusicAdapter` and `SpotifyAdapter` implement it
- Provider-aware tool registration: unprefixed when one service, prefixed (`apple_music_*`, `spotify_*`) when both connected
- Spotify gets 6 extra tools: `remove_playlist`, `remove_tracks_from_playlist`, `reorder_playlist_tracks`, `update_playlist`, `remove_from_library`, `get_top_items`
- Adapters declare `supportedCapabilities` — tool registration is data-driven
- Discriminated token union (`AppleMusicTokens | SpotifyTokens`) with `kind` field

## Project Status & Plans

- See `docs/PROJECT-STATUS.md` for full architecture, what's built, and what's next
- See `docs/plans/` for feature design docs
- See `docs/features/` for feature tracking and backlog
