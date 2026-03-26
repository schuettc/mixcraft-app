import { createClerkClient } from '@clerk/backend';
import { getSecret } from './secrets.js';

let cachedClerkClient: ReturnType<typeof createClerkClient> | null = null;

async function getClerkClient() {
  if (cachedClerkClient) return cachedClerkClient;
  const secretKey = await getSecret(process.env.CLERK_SECRET_KEY_NAME!);
  cachedClerkClient = createClerkClient({ secretKey });
  return cachedClerkClient;
}

/** Maps our internal provider names to Clerk's OAuth provider identifiers. */
const CLERK_PROVIDER_MAP = {
  spotify: 'spotify',
  apple_music: 'apple',
} as const;

export interface OAuthTokenResult {
  token: string;
  expiresAt?: number;
}

/**
 * Fetches the OAuth access token for a user from Clerk.
 * Returns the token and optional expiry, or null if not available.
 */
export async function getOAuthTokenForProvider(
  userId: string,
  provider: string,
): Promise<OAuthTokenResult | null> {
  const clerkProvider = CLERK_PROVIDER_MAP[provider as keyof typeof CLERK_PROVIDER_MAP];
  if (!clerkProvider) return null;

  const client = await getClerkClient();
  const response = await client.users.getUserOauthAccessToken(userId, clerkProvider);

  if (!response.data || response.data.length === 0) {
    return null;
  }

  const tokenData = response.data[0];
  return {
    token: tokenData.token,
    // Clerk exposes expiresAt on some OAuth tokens
    expiresAt: (tokenData as unknown as Record<string, unknown>).expiresAt as number | undefined,
  };
}
