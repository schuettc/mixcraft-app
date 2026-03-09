# CLAUDE.md - Project Conventions

## Overview

Universal Music MCP - a hosted MCP server that acts as an authenticated proxy
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

- `packages/server` - Hosted MCP server (Lambda)
- `packages/portal` - Web portal (React + Vite) for user self-service
- `packages/portal-api` - Portal backend (Lambda)
- `packages/infra` - AWS CDK infrastructure
- `packages/plugin` - Claude Code plugin

## Infrastructure

- AWS CDK for infrastructure
- Secrets never in code or environment variables at rest
- API key format: `mmc_` + 32 hex chars, stored as SHA-256 hash
