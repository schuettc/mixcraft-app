---
id: spotify-support
name: Spotify Support
type: Feature
priority: P0
effort: Large
impact: High
created: 2026-03-25
---

# Spotify Support

## Problem Statement
MixCraft currently only supports Apple Music. Many users use Spotify as their primary music service and cannot use MixCraft at all. Adding Spotify support would significantly expand the user base and make MixCraft a truly multi-service music platform.

## Proposed Solution
Add Spotify as a second supported music service alongside Apple Music, allowing users to connect their Spotify account and use the same MCP tools (search, playlists, library management) with Spotify's catalog and their personal library.

## Affected Areas
- mcp-server (new Spotify API integration and tools)
- web portal (Spotify OAuth connection flow)
- infra (Spotify secrets, OAuth config, CDK changes)
- mcp-proxy (multi-service support in CLI layer)
