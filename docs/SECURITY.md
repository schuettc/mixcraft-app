# Security & Data Handling

This document explains how MixCraft handles your credentials and music service tokens.

## Architecture

```
Claude  <--stdio-->  CLI (npx mixcraft-app)  <--HTTPS-->  Lambda MCP Server  <--REST-->  Apple Music API
                                                              |                \----->  Spotify API
                                                         DynamoDB (encrypted tokens)
                                                              |
                                                         AWS KMS (encryption keys)
```

All infrastructure runs on AWS in `us-east-1`. The source code for every component is in this repository.

## What MixCraft stores

| Data | How it's stored | Purpose |
|------|----------------|---------|
| **User ID** | Clerk authentication ID in DynamoDB | Links your portal account to your data |
| **API key** | SHA-256 hash in DynamoDB (the raw key is never stored) | Authenticates CLI requests |
| **Music service tokens** | Encrypted with AWS KMS, stored as ciphertext in DynamoDB | Calls Apple Music / Spotify APIs on your behalf |
| **Apple developer credentials** | AWS Secrets Manager (never in code or environment variables) | Signs Apple Music API requests |
| **Clerk secret key** | AWS Secrets Manager | Refreshes Spotify OAuth tokens via Clerk |

## What MixCraft does NOT store

- Your Apple ID, Apple password, or Spotify password
- Your music service tokens in plaintext
- Any listening data, search queries, or playlist contents — these pass through to the music service and are not logged or persisted

## Token encryption

When you connect a music service through the portal:

1. **Apple Music**: MusicKit JS issues a user token via OAuth in your browser
2. **Spotify**: Clerk handles the OAuth flow and stores the access token
3. The portal sends the token to the MixCraft API over HTTPS
4. The API encrypts it with a dedicated AWS KMS key using AES-256-GCM (via the KMS `Encrypt` API)
5. Only the ciphertext is stored in DynamoDB
6. When a tool call needs your token, the Lambda decrypts it in-memory, makes the API call, and discards the plaintext

The KMS key is configured with IAM policies that restrict decrypt access to the MixCraft Lambda functions only.

### Spotify token refresh

Spotify access tokens expire after approximately 1 hour. The MCP server automatically refreshes them via Clerk's backend SDK — both proactively (before expiry) and reactively (if a 401 is received). Refreshed tokens are re-encrypted and stored in DynamoDB. No user interaction is needed for refresh.

## API key security

- API keys use the format `mx_` + 32 random hex characters (128 bits of entropy)
- The raw key is shown once at creation and never stored
- Only the SHA-256 hash is persisted in DynamoDB
- When the CLI sends a request, the server hashes the provided key and looks up the hash

## Network security

- All API traffic uses HTTPS (TLS 1.2+)
- The CLI communicates with `mcp.mixcraft.app` — there is no direct connection between your machine and Apple Music or Spotify
- CORS is restricted to `mixcraft.app` for the portal API
- The MCP endpoint accepts requests only with a valid API key in the `Authorization` header

## Authentication

- The web portal uses [Clerk](https://clerk.com) for authentication (supports Spotify and Apple social login)
- Webhook signatures are verified using Svix to prevent spoofing
- Portal API routes require a valid Clerk session token
- MCP API routes require a valid MixCraft API key (separate from Clerk)

## Revoking access

- **Delete your API key** at [mixcraft.app](https://mixcraft.app) — this immediately prevents all CLI access
- **Disconnect a music service** at [mixcraft.app](https://mixcraft.app) — this deletes your encrypted token from DynamoDB
- Both actions take effect immediately with no propagation delay

## Open source

The entire codebase is open source under the MIT license. You can audit every component:

- [`packages/mcp-proxy`](../packages/mcp-proxy) — CLI that runs on your machine
- [`packages/mcp-server`](../packages/mcp-server) — Lambda that processes MCP tool calls
- [`packages/api`](../packages/api) — Portal backend for auth, keys, and token management
- [`packages/web`](../packages/web) — Portal frontend
- [`packages/infra`](../packages/infra) — AWS CDK infrastructure definitions

## Reporting security issues

If you find a security vulnerability, please email the maintainer directly rather than opening a public issue. Contact information is in the [plugin manifest](../packages/plugin/.claude-plugin/plugin.json).
