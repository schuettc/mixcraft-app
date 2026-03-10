# Clerk Production Setup Plan

> Status: Not started
> Date: 2026-03-09

## Context

The Mixcraft portal currently uses Clerk in **development mode** (`pk_test_` publishable key). Development mode shows a dev banner, uses Clerk's dev domain (`clerk.accounts.dev`), and is not suitable for production traffic. Before promoting Mixcraft for real users, we need to switch to a Clerk production instance.

## What Changes

| Aspect | Dev (current) | Production (target) |
|--------|--------------|---------------------|
| Publishable key | `pk_test_...` | `pk_live_...` |
| Auth domain | `*.clerk.accounts.dev` | Custom or Clerk production domain |
| Dev banner | Visible | Gone |
| Webhook endpoint | May not be configured | `api.mixcraft.app/webhooks/clerk` |
| Secret key | Stored in Secrets Manager (dev) | New production secret in Secrets Manager |

## Prerequisites

- [ ] Clerk account upgraded to a plan that supports production instances (check current plan limits)
- [ ] `mixcraft.app` domain verified in Clerk (for custom auth pages)
- [ ] AWS SSO session active (`AWS_PROFILE=playlists aws sso login`)

## Steps

### 1. Create Clerk Production Instance

1. Log into [Clerk Dashboard](https://dashboard.clerk.com)
2. Navigate to the Mixcraft application
3. Switch to **Production** mode (or create a production instance if on a plan that requires it)
4. Configure allowed origins: `https://mixcraft.app`
5. Configure redirect URLs: `https://mixcraft.app`
6. Note the new **publishable key** (`pk_live_...`) and **secret key** (`sk_live_...`)

### 2. Configure Auth Settings in Clerk Production

1. **Sign-in methods**: Match dev settings (email, OAuth providers, etc.)
2. **Session settings**: Review token lifetime, multi-session behavior
3. **User profile**: Ensure email is a required field (portal relies on `primaryEmailAddress`)

### 3. Set Up Webhook in Clerk Production

1. In Clerk Dashboard → Webhooks, create a new endpoint:
   - **URL**: `https://api.mixcraft.app/webhooks/clerk`
   - **Events**: `user.created`, `user.deleted` (match what `packages/api/src/routes/auth.ts` handles)
2. Copy the **Signing Secret** from the webhook configuration

### 4. Store Production Secrets in AWS Secrets Manager

```bash
# Store the Clerk secret key
AWS_PROFILE=playlists aws secretsmanager create-secret \
  --name "mixcraft/prod/clerk-secret-key" \
  --secret-string "sk_live_..." \
  --region us-east-1

# Store the webhook signing secret
AWS_PROFILE=playlists aws secretsmanager create-secret \
  --name "mixcraft/prod/clerk-webhook-secret" \
  --secret-string "whsec_..." \
  --region us-east-1
```

> **Note**: If these secrets already exist from a previous attempt, use `put-secret-value` instead of `create-secret`.

### 5. Update CDK Configuration

Update `packages/infra/cdk.json` to use the production publishable key:

```json
{
  "context": {
    "clerkPublishableKey": "pk_live_..."
  }
}
```

The Secrets Manager paths (`mixcraft/prod/clerk-secret-key`, `mixcraft/prod/clerk-webhook-secret`) should already match what the CDK stack references. Verify in `packages/infra/src/index.ts` that the environment variable resolves to `prod`:

```typescript
clerkSecretKeyName: `mixcraft/${environment}/clerk-secret-key`,
clerkWebhookSecretName: `mixcraft/${environment}/clerk-webhook-secret`,
```

If the environment is `dev`, the secret names won't match. Check what `environment` resolves to and either:
- Change the CDK environment to `prod`, or
- Use the existing secret path (e.g., `mixcraft/dev/clerk-secret-key`) and update the dev secrets with production values

### 6. Deploy

```bash
cd packages/infra && AWS_PROFILE=playlists npx cdk deploy --all
```

This will:
- Update the portal's `config.json` with the `pk_live_` key (via `portal.deployContent()`)
- Lambda functions will read the new secrets on next cold start

### 7. Verify

- [ ] Visit `mixcraft.app` — no Clerk dev banner
- [ ] Sign in flow works (new users are created in Clerk production, not dev)
- [ ] Webhook fires on user creation (check Lambda logs for `/webhooks/clerk`)
- [ ] API key creation works (Clerk session validation uses production secret)
- [ ] Apple Music connect flow works end-to-end

### 8. Post-Migration Cleanup

- [ ] Confirm no traffic is hitting Clerk dev instance
- [ ] Consider disabling/archiving the Clerk dev instance
- [ ] Update any local `.env` files or `config.json` overrides team members may have

## Risks & Gotchas

- **Existing dev users won't exist in production Clerk.** Anyone who signed up during dev will need to sign up again. Their DynamoDB records (keyed by Clerk user ID) will be orphaned. This is fine for a pre-launch app.
- **Webhook secret mismatch** will cause silent 401s on the webhook endpoint. Test by creating a new user and verifying the DynamoDB Users table gets a new record.
- **CDK environment variable**: The current stack is `Mixcraft-dev`. The secret paths use `mixcraft/{env}/...`. Make sure the `environment` value in `packages/infra/src/index.ts` matches the secret paths you created. If it's hardcoded to `dev`, either rename it or store production Clerk secrets under the `dev` path.
- **Clerk plan limits**: Free tier may not support production instances or custom domains. Check plan requirements before starting.

## Estimated Effort

This is a configuration task, not a code change. ~30 minutes if Clerk account is already upgraded and domain is verified.
