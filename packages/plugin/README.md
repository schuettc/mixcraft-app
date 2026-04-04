# MixCraft Plugin for Claude Code

A playlist assistant plugin that helps Claude build great playlists, learn your music taste, and manage your music library through the MixCraft MCP server.

## What You Get

- **MixCraft MCP Server** — auto-configured, giving Claude access to your Apple Music and/or Spotify library (search, playlists, recently played, library management)
- **Playlist Assistant Skill** — teaches Claude to curate playlists with intentional energy arcs, genre bridges, and a mix of familiar favorites and new discoveries
- **Taste Memory** — Claude remembers your music preferences across sessions in `.claude/mixcraft.local.md`

## Prerequisites

1. An Apple Music account, a Spotify account, or both
2. A MixCraft account at [mixcraft.app](https://mixcraft.app) with your music service connected

## Installation

Add the marketplace and install at project scope (recommended) so the plugin is available to everyone working on the project:

```
/plugin marketplace add schuettc/mixcraft-app
/plugin install mixcraft@mixcraft-app --scope project
```

Or install at local scope (gitignored, just for you):

```
/plugin install mixcraft@mixcraft-app --scope local
```

## Configuration

Set the OAuth client ID as an environment variable:

```bash
export MIXCRAFT_OAUTH_CLIENT_ID="FLECRN3FqkNiXtGI"
```

Add this to your shell profile (`.bashrc`, `.zshrc`, etc.) so it persists across sessions.

On first use, your browser will open to sign in with your MixCraft account. Tokens are cached at `~/.mixcraft/token.json` and refreshed automatically.

## Usage

Once installed, just ask Claude about music naturally:

- "Make me a playlist for a long drive"
- "What have I been listening to lately?"
- "Add some new songs to my workout playlist"
- "I need focus music for coding"
- "Find me something like Radiohead but more electronic"

Claude will check your listening history and preferences before making recommendations, and always confirm before creating playlists or adding tracks. It's aware of service-specific constraints (e.g., Apple Music playlists can't be deleted via API, but Spotify's can) and adjusts its behavior accordingly.
