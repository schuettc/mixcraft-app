# mixcraft-app

CLI for [Mixcraft](https://mixcraft.app) — connects Claude to your music services (Apple Music) via MCP. Works with both Claude Code and Claude Desktop.

## Quick Start

1. Sign up at [mixcraft.app](https://mixcraft.app)
2. Connect your Apple Music account
3. Create an API key

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "mixcraft": {
      "command": "npx",
      "args": ["-y", "mixcraft-app@latest"],
      "env": {
        "MIXCRAFT_API_KEY": "mx_your_key_here"
      }
    }
  }
}
```

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
        "MIXCRAFT_API_KEY": "mx_your_key_here"
      }
    }
  }
}
```

After saving, restart Claude Desktop. The mixcraft connector will appear under **Settings > Connectors** with all 8 music tools available.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MIXCRAFT_API_KEY` | Yes | Your API key from [mixcraft.app](https://mixcraft.app) |

## Available Tools

| Tool | Description |
|------|-------------|
| `search_catalog` | Search for songs, albums, and artists |
| `list_playlists` | List your library playlists |
| `get_playlist_tracks` | Get tracks in a playlist |
| `create_playlist` | Create a new playlist |
| `add_tracks` | Append tracks to a playlist |
| `get_recently_played` | Get recently played tracks |
| `get_library_songs` | Get songs in your library |
| `add_to_library` | Add songs or albums to your library |

## How It Works

The CLI creates a local MCP stdio server that proxies tool calls to the hosted Mixcraft API at `mcp.mixcraft.app`. Your API key authenticates requests and resolves to your encrypted music service tokens.

## License

MIT
