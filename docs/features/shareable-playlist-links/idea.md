---
id: shareable-playlist-links
name: Shareable Playlist Links
type: Feature
priority: P0
effort: Medium
impact: High
created: 2026-03-25
---

# Shareable Playlist Links

## Problem Statement
When users create playlists through MixCraft conversations with Claude, the context behind *why* those playlists were curated is lost. Users want to share not just the playlist itself, but the conversation that led to it — the mood they described, the refinements they made, the story behind the selection.

Currently there's no way to generate a public, shareable link that captures this context. Users also need the ability to manage (delete) their shared playlists.

## Key Requirements
- Users can create a public shareable link from a playlist conversation
- The shared page shows the conversation flow that led to the playlist creation
- **No identifying information** is included in the shared playlist (no usernames, emails, or account details)
- Users are clearly informed that the link is **public** before sharing
- Users can delete their own shared playlists at any time
- Shared playlists remain accessible to anyone with the link until deleted

## Affected Areas
- mcp-server (new tools: share playlist, delete shared playlist)
- api (new endpoints for storing/serving/deleting shared playlists)
- web (public playlist view page, management in portal)
- infra (DynamoDB table for shared playlists, routing)
