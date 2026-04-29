---
id: spotify-deployment-flag
name: Spotify Deployment Flag
type: Feature
priority: P1
effort: Medium
impact: High
created: 2026-04-29
---

# Spotify Deployment Flag

## Problem Statement

Spotify's developer program does not allow open public access — apps stay in
"development mode" with a hard allowlist of users that cannot be expanded for
general distribution. This means the hosted version of MixCraft at
`mixcraft.app` cannot meaningfully offer Spotify support to the public, even
though all the integration code (adapter, OAuth flow, refresh logic, portal UI)
is built and working.

We don't want to delete the Spotify code — it's solid work, and the project
is open source. Self-hosters who want to run MixCraft for themselves and a few
friends should still be able to enable Spotify by registering their own
Spotify dev app and adding their friends to its allowlist.

We need a way to ship the hosted `mixcraft.app` deployment as Apple-Music-only
while keeping every line of Spotify code in the repo and making it trivially
re-enabled by anyone who forks and self-hosts.

## Proposed Solution

Single deployment-time flag (`enableSpotify`) wired through:

- CDK context → `MixcraftStackProps`
- Lambda environment variable on both MCP server and portal API
- Runtime `config.json` baked into S3 by the web construct (since the portal
  is S3/CloudFront, not a Vite-time env var)
- Conditional Spotify route handlers, adapter registration, secret IAM grants,
  and portal UI cards

Self-hosting documentation explaining how to flip the flag, register a Spotify
dev app, manage the allowlist, and store secrets.

README updates so the project's positioning is honest: hosted = Apple Music,
self-host = both.

## Affected Areas

- packages/infra (CDK context, stack props, web construct config.json, Lambda env, secret grants)
- packages/mcp-server (gate Spotify adapter registration in handler)
- packages/api (gate Spotify OAuth routes and service connect validation)
- packages/web (read enableSpotify from config.json, conditionally render Spotify UI)
- docs (new SELF-HOSTING.md, README updates)
- Root README and packages/web README/portal copy
