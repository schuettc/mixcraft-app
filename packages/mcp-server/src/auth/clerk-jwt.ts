import { verifyToken } from '@clerk/backend';
import { getSecret } from '../shared/secrets.js';
import { AuthenticationError, UpstreamAuthError } from '../shared/errors.js';

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

  let res: Response;
  try {
    res = await fetch(userinfoUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    // Network error / timeout reaching Clerk — the token was never judged.
    throw new UpstreamAuthError(undefined, err);
  }

  if (!res.ok) {
    // Only 401/403 mean Clerk actually looked at the token and rejected it.
    // Anything else (429, 5xx) is Clerk failing to answer, which must not be
    // reported as a bad credential.
    if (res.status === 401 || res.status === 403) {
      throw new AuthenticationError('Invalid or expired token', res.status);
    }
    throw new UpstreamAuthError(res.status);
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
