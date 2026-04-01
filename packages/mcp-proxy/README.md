# mixcraft-app

CLI for [MixCraft](https://mixcraft.app) — connects Claude to your music services (Apple Music and Spotify) via MCP. Works with Claude Code, Claude Desktop, and claude.ai.

## Quick Start

1. Sign up at [mixcraft.app](https://mixcraft.app)
2. Connect your music service (Apple Music, Spotify, or both)

### claude.ai (Recommended)

Add MixCraft as a connector directly in claude.ai — no CLI needed:

1. Go to **Settings > Connectors > Add custom connector**
2. Fill in:
   - **Name**: `Mixcraft`
   - **Remote MCP server URL**: `https://mcp.mixcraft.app/mcp`
   - **OAuth Client ID**: `FLECRN3FqkNiXtGI`
3. Click **Add**, then authorize with your MixCraft account

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "mixcraft": {
      "command": "npx",
      "args": ["-y", "mixcraft-app@latest"],
      "env": {
        "MIXCRAFT_OAUTH_CLIENT_ID": "FLECRN3FqkNiXtGI"
      }
    }
  }
}
```

The first time the server starts, it will open your browser to sign in. Your token is cached at `~/.mixcraft/token.json` and refreshed automatically.

### Claude Desktop

Add to your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mixcraft": {
      "command": "npx",
      "args": ["-y", "mixcraft-app@latest"],
      "env": {
        "MIXCRAFT_OAUTH_CLIENT_ID": "FLECRN3FqkNiXtGI"
      }
    }
  }
}
```

After saving, restart Claude Desktop. MixCraft will appear under **Settings > Connectors**.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MIXCRAFT_OAUTH_CLIENT_ID` | OAuth client ID (recommended) |
| `MIXCRAFT_API_KEY` | Legacy API key — deprecated, will be removed in a future release |

## Available Tools

Tools are registered based on which services you've connected. When both are connected, tools are prefixed (`apple_music_*`, `spotify_*`).

**Shared tools** (8, available for either service):

| Tool | Description |
|------|-------------|
| `search_catalog` | Search for songs, albums, and artists |
| `list_playlists` | List your library playlists |
| `get_playlist_tracks` | Get tracks in a playlist |
| `create_playlist` | Create a new playlist |
| `add_tracks` | Add tracks to a playlist |
| `get_recently_played` | Get recently played tracks |
| `get_library_songs` | Get songs in your library |
| `add_to_library` | Add songs or albums to your library |

**Spotify-only tools** (6, registered when Spotify is connected):

| Tool | Description |
|------|-------------|
| `remove_playlist` | Remove (unfollow) a playlist |
| `remove_tracks_from_playlist` | Remove specific tracks from a playlist |
| `reorder_playlist_tracks` | Reorder tracks in a playlist |
| `update_playlist` | Rename, update description, or change visibility |
| `remove_from_library` | Remove songs or albums from your library |
| `get_top_items` | Your top artists or tracks by listening history |

## How It Works

The CLI creates a local MCP stdio server that proxies tool calls to the hosted MixCraft API at `mcp.mixcraft.app`. Authentication uses OAuth 2.0 with PKCE — sign in once via your browser and the token is cached and refreshed automatically.

## License

MIT
