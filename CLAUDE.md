# CLAUDE.md - Project Conventions

## Overview

Mixcraft - a hosted MCP server that acts as an authenticated proxy
between Claude Code and music services (starting with Apple Music).

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

## Packages

- `packages/cli` - CLI (`npx mixcraft-app`) - stdio-to-HTTP MCP proxy
- `packages/server` - Hosted MCP server (Lambda)
- `packages/portal` - Web portal (React + Vite) for user self-service
- `packages/portal-api` - Portal backend (Lambda)
- `packages/infra` - AWS CDK infrastructure
- `packages/plugin` - Claude Code plugin

## Infrastructure

- AWS CDK for infrastructure
- Secrets never in code or environment variables at rest
- API key format: `mx_` + 32 hex chars, stored as SHA-256 hash
- Domains: mixcraft.app (portal), api.mixcraft.app (portal API), mcp.mixcraft.app (MCP server)
- Deploy: `cd packages/infra && npx cdk deploy --all`

## MCP SDK

- Use `McpServer` (high-level, recommended), NOT `Server` (deprecated)
- `McpServer.tool()` requires Zod schemas, not plain JSON Schema objects
- SDK version: ^1.0.0

## Project Status & Plans

- See `docs/PROJECT-STATUS.md` for full architecture, what's built, and what's next
- See `docs/plans/` for feature design docs
- **Next feature**: Conditional tool registration (only register tools for connected services)
