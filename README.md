# MixCraft

Give Claude access to your music library. MixCraft is a hosted MCP server that connects Claude Code and Claude Desktop to Apple Music and Spotify, letting Claude search your library, build playlists, and learn your taste over time.

**[mixcraft.app](https://mixcraft.app)** — set up in 60 seconds.

## Quick Start

### 1. Get an API key

Visit [mixcraft.app](https://mixcraft.app), sign in, connect your music service (Apple Music, Spotify, or both), and create an API key.

### 2. Set your API key

Add this to your shell profile (`.bashrc`, `.zshrc`, etc.):

```bash
export MIXCRAFT_API_KEY="mx_your_key_here"
```

### 3. Install the Claude Code plugin

The MixCraft plugin gives Claude both the MCP tools and a playlist assistant skill that teaches it how to curate great playlists and remember your preferences.

```
/plugin marketplace add schuettc/mixcraft-app
/plugin install mixcraft@mixcraft-app --scope project
```

Restart Claude Code to activate the plugin.

### 4. Use it

Just ask Claude about music:

- "Make me a playlist for a long drive"
- "What have I been listening to lately?"
- "Add some new songs to my workout playlist"
- "Find me something like Radiohead but more electronic"
- "I need focus music for coding"

## What You Get

### MCP Tools

Tools are registered based on which services you've connected. When both Apple Music and Spotify are connected, tools are prefixed (`apple_music_*`, `spotify_*`) so Claude knows which service to use.

**Shared tools** (available for both services):

| Tool | Description |
|------|-------------|
| `search_catalog` | Search songs, albums, and artists |
| `list_playlists` | List your library playlists |
| `get_playlist_tracks` | Get tracks in a playlist |
| `create_playlist` | Create a new playlist |
| `add_tracks` | Add tracks to a playlist |
| `get_recently_played` | Recent listening history |
| `get_library_songs` | Songs in your library |
| `add_to_library` | Add songs or albums to your library |

**Spotify-only tools** (registered only when Spotify is connected):

| Tool | Description |
|------|-------------|
| `remove_playlist` | Remove (unfollow) a playlist |
| `remove_tracks_from_playlist` | Remove specific tracks from a playlist |
| `reorder_playlist_tracks` | Reorder tracks in a playlist |
| `update_playlist` | Rename, update description, or change visibility |
| `remove_from_library` | Remove songs or albums from your library |
| `get_top_items` | Your top artists or tracks by listening history |

### Playlist Assistant Skill

The plugin includes a skill that teaches Claude to be a thoughtful music companion:

- **Knows your taste** — checks your recently played and library before recommending anything
- **Curates intentionally** — builds playlists with energy arcs, genre bridges, and a mix of familiar favorites and new discoveries
- **Remembers preferences** — stores your likes, dislikes, and listening contexts in `.claude/mixcraft.local.md` so future sessions build on past ones
- **Service-aware** — knows the differences between Apple Music and Spotify (e.g., Apple Music playlists can't be deleted via API, Spotify's can) and adjusts behavior accordingly

## Claude Desktop

MixCraft also works with Claude Desktop. Add this to your config file:

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

This gives you the MCP tools without the playlist assistant skill.

## Manual MCP Setup (without the plugin)

If you prefer not to use the plugin, add this to your project's `.mcp.json`:

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

## How It Works

MixCraft runs as a hosted service so you don't need to manage developer credentials or run any servers.

```
Claude  <--stdio-->  CLI (npx mixcraft-app)  <--HTTPS-->  MixCraft API  <--REST-->  Apple Music / Spotify
```

1. You connect your music service at [mixcraft.app](https://mixcraft.app) — Apple Music via MusicKit OAuth, Spotify via Clerk OAuth
2. Your music service tokens are encrypted with AWS KMS and stored in DynamoDB — MixCraft never sees or stores tokens in plaintext
3. When Claude calls a tool, the CLI sends the request to the MixCraft API with your API key
4. The API decrypts your token, calls the appropriate music service on your behalf, and returns the results
5. Spotify tokens are automatically refreshed when they expire — no re-authorization needed

For more details on security and data handling, see [SECURITY.md](docs/SECURITY.md).

## License

MIT
