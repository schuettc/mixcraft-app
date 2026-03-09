# mixcraft-app

CLI for [Mixcraft](https://mixcraft.app) — connects Claude Code to your music services (Apple Music) via MCP.

## Quick Start

1. Sign up at [mixcraft.app](https://mixcraft.app)
2. Connect your Apple Music account
3. Create an API key
4. Add to your Claude Code MCP config:

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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MIXCRAFT_API_KEY` | Yes | Your API key from [mixcraft.app](https://mixcraft.app) |

## How It Works

The CLI creates a local MCP stdio server that proxies tool calls to the hosted Mixcraft API at `api.mixcraft.app`. Your API key authenticates requests and resolves to your encrypted music service tokens.

## License

MIT
