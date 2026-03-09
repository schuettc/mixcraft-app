# Mixcraft

A hosted MCP server that connects Claude Code to your music services. Connect your Apple Music account through the web portal, get an API key, and use `npx mixcraft-app@latest` to give Claude access to your music library.

## Quick Start

1. Sign up at [mixcraft.app](https://mixcraft.app)
2. Connect your Apple Music account
3. Create an API key
4. Add to your `.mcp.json`:

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

## Available Tools

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

## Architecture

```
Claude Code  <--stdio-->  CLI (npx mixcraft-app)  <--HTTP-->  Lambda MCP Server  <--REST-->  Apple Music API
                                                                    |
                                                               DynamoDB (users, API keys, encrypted tokens)
                                                                    |
                                                               KMS (token encryption)
```

## Packages

| Package | Description |
|---------|-------------|
| `packages/cli` | `npx mixcraft-app` — stdio-to-HTTP MCP proxy ([npm](https://www.npmjs.com/package/mixcraft-app)) |
| `packages/server` | Lambda MCP server with Apple Music adapter |
| `packages/portal` | React + Vite web portal ([mixcraft.app](https://mixcraft.app)) |
| `packages/portal-api` | Portal backend API |
| `packages/infra` | AWS CDK infrastructure |

## Development

```bash
pnpm install
pnpm -r build
pnpm -r test
```

### Deploy

```bash
AWS_PROFILE=playlists aws sso login
cd packages/infra && AWS_PROFILE=playlists npx cdk deploy --all
```

## License

MIT
