import { verifyToken } from '@clerk/backend';
import { getSecret } from '../shared/secrets.js';
import { AuthenticationError } from '../shared/errors.js';

let cachedClerkKey: string | null = null;

async function getClerkSecretKey(): Promise<string> {
  if (cachedClerkKey) return cachedClerkKey;
  cachedClerkKey = await getSecret(process.env.CLERK_SECRET_KEY_NAME!);
  return cachedClerkKey;
}

async function validateViaUserinfo(
  token: string,
): Promise<{ userId: string }> {
  const userinfoUrl = process.env.CLERK_OAUTH_USERINFO_URL
    || 'https://clerk.mixcraft.app/oauth/userinfo';

  const res = await fetch(userinfoUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new AuthenticationError('Invalid or expired token');
  }

  const data = (await res.json()) as { user_id?: string; sub?: string };
  const userId = data.user_id || data.sub;

  if (!userId) {
    throw new AuthenticationError('Invalid token: missing user identity');
  }

  return { userId };
}

export async function validateClerkJwt(
  token: string,
): Promise<{ userId: string }> {
  const secretKey = await getClerkSecretKey();

  // Try Clerk session JWT validation first
  try {
    const payload = await verifyToken(token, { secretKey });
    if (payload.sub) {
      return { userId: payload.sub };
    }
  } catch {
    // Not a session JWT — try OAuth token validation via userinfo
  }

  return validateViaUserinfo(token);
}
