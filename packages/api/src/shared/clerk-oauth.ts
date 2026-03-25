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
  spotify: 'oauth_spotify',
  apple_music: 'oauth_apple',
} as const;

/**
 * Fetches the OAuth access token for a user from Clerk.
 * Returns the token string or null if not available.
 */
export async function getOAuthTokenForProvider(
  userId: string,
  provider: string,
): Promise<string | null> {
  const clerkProvider = CLERK_PROVIDER_MAP[provider as keyof typeof CLERK_PROVIDER_MAP];
  if (!clerkProvider) return null;

  const client = await getClerkClient();
  const response = await client.users.getUserOauthAccessToken(userId, clerkProvider);

  if (!response.data || response.data.length === 0) {
    return null;
  }

  return response.data[0].token;
}
