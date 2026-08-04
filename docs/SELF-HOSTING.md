# Self-Hosting MixCraft

The hosted [mixcraft.app](https://mixcraft.app) deploy supports Apple Music
only. Spotify's developer program restricts apps to an allowlist that cannot
be expanded for general public distribution, so we cannot offer Spotify in
the hosted product. If you want Spotify (for yourself and a few friends), or
you simply want to run the entire stack on your own AWS account, this guide
walks through it.

## What you get with self-hosting

- The same MCP server, portal, and CLI as `mixcraft.app`
- Optional Spotify integration — gated behind a single CDK context flag
  (`-c enableSpotify=true`)
- Your own custom domain (the stack assumes you have a Route 53 hosted zone
  for it)
- Your own Clerk tenant for authentication
- Full control of monitoring and secrets

## Prerequisites

- AWS account with `cdk bootstrap` already run
- A domain in Route 53 (e.g. `your.domain`)
- Node 20+, pnpm 9+
- A Clerk account (`https://clerk.com`) and a tenant configured for your
  domain — see the existing `MixcraftStack` props for the secret names you
  need to seed
- Optional, only if you want Spotify: a Spotify dev app (see below)

## Step 1: Spotify dev app (optional, only if enabling Spotify)

1. Register an app at <https://developer.spotify.com/dashboard>.
2. Add the redirect URI for your portal API:
   `https://api.<your-domain>/api/spotify/callback`.
3. Add the users you want to grant access to under **Users and Access**.
   Spotify caps non-extended-quota apps at 25 users; users not on this
   allowlist will get a 403 from Spotify when they try to authorize.
4. Note the **Client ID** and **Client Secret** — you'll seed them into
   AWS Secrets Manager next.

## Step 2: Seed secrets in AWS Secrets Manager

The stack uses these secret names (where `<env>` is whatever you pass via
`-c environment=<env>`, defaulting to `dev`):

| Secret name | Required when | Contents |
| --- | --- | --- |
| `mixcraft/<env>/apple-team-id` | always | Apple Developer Team ID |
| `mixcraft/<env>/apple-key-id` | always | Apple MusicKit Key ID |
| `mixcraft/<env>/apple-private-key` | always | Apple MusicKit `.p8` contents |
| `mixcraft/<env>/clerk-secret-key` | always | Clerk backend secret key |
| `mixcraft/<env>/clerk-webhook-secret` | always | Clerk webhook signing secret |
| `mixcraft/<env>/spotify-client-id` | only with `enableSpotify=true` | Spotify Client ID |
| `mixcraft/<env>/spotify-client-secret` | only with `enableSpotify=true` | Spotify Client Secret |

If you deploy without `enableSpotify=true`, the Spotify secrets are never
looked up and don't need to exist.

## Step 3: Build the workspace

```bash
pnpm install
pnpm -r build
```

## Step 4: Deploy

### Apple Music only (matches hosted mixcraft.app)

```bash
cd packages/infra
AWS_PROFILE=<your-profile> npx cdk deploy --all \
  -c environment=dev \
  -c domainName=your.domain \
  -c clerkPublishableKey=pk_live_...
```

### With Spotify enabled

```bash
cd packages/infra
AWS_PROFILE=<your-profile> npx cdk deploy --all \
  -c environment=dev \
  -c domainName=your.domain \
  -c clerkPublishableKey=pk_live_... \
  -c enableSpotify=true
```

The `-c enableSpotify=true` flag toggles three things in one go:

- The MCP server Lambda registers the Spotify adapter at request time, so
  Spotify tools appear in the MCP tool list.
- The portal API Lambda accepts `/api/spotify/auth-url` and
  `/api/spotify/callback`, and the `connect/disconnect/status` endpoints
  accept `provider: spotify`.
- The portal's runtime `config.json` (baked into S3 at deploy) carries
  `enableSpotify: true`, so the React app shows the **Connect Spotify**
  card.

## Step 5: Smoke test

After deploy:

- Visit `https://your.domain/setup` — Apple Music card always appears;
  Spotify card appears only if you deployed with `enableSpotify=true`.
- `curl https://api.your.domain/api/spotify/auth-url` —
  - 401 if Spotify is enabled (auth required)
  - 404 if Spotify is disabled
- Hit your MCP server with a connected user and confirm the tool list
  matches what you expect.

## Switching the flag later

Spotify is a deploy-time flag, not a runtime toggle — flipping it requires
another `cdk deploy`. If you turn Spotify off after users have already
connected, their stored tokens stay encrypted in DynamoDB. The portal will
hide the Spotify UI and the MCP server will not expose Spotify tools, but
nothing is destructively changed; flipping back on re-activates everything.

## Caveats

- **Spotify allowlist is hard-capped.** If you outgrow your dev app's user
  cap, you'd need to apply for Spotify's extended quota mode. Approval is
  not guaranteed and is the entire reason hosted `mixcraft.app` is
  Apple-only.
- **Clerk OAuth callback URLs.** When you change domains or add Spotify,
  update the redirect/origin lists in your Clerk dashboard.
- **You own the secrets.** Rotation, audit, and access policies are on you.
  The CDK only references the secrets by name — it does not create them.
