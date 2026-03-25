---
id: social-login-providers
name: Spotify & Apple Music Social Login
type: Feature
priority: P0
effort: Medium
impact: High
created: 2026-03-25
---

# Spotify & Apple Music Social Login

## Problem Statement
Users currently have no way to sign in with their Spotify or Apple Music accounts directly through Clerk. With the recent Clerk upgrade supporting social logins, MixCraft can leverage OAuth-based sign-in for both providers. This eliminates friction in the onboarding flow — users authenticate once with their music provider and MixCraft automatically gains the connection needed to access their music services, rather than requiring a separate linking step after sign-up.

## Proposed Solution
Enable Spotify and Apple Music as social login providers in Clerk. Update the portal sign-in/sign-up UI to surface these options. Use the OAuth tokens from social login to establish music service connections, reducing the current multi-step connection flow to a single sign-in action.

## Affected Areas
- packages/web (sign-in UI, connection management)
- packages/api (token handling, service connection logic)
- packages/mcp-server (service connection integration)
- packages/infra (Clerk provider configuration)
