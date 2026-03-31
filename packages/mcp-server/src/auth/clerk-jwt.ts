import { verifyToken } from '@clerk/backend';
import { getSecret } from '../shared/secrets.js';
import { AuthenticationError } from '../shared/errors.js';

let cachedClerkKey: string | null = null;

async function getClerkSecretKey(): Promise<string> {
  if (cachedClerkKey) return cachedClerkKey;
  cachedClerkKey = await getSecret(process.env.CLERK_SECRET_KEY_NAME!);
  return cachedClerkKey;
}

export async function validateClerkJwt(
  token: string,
): Promise<{ userId: string }> {
  const secretKey = await getClerkSecretKey();

  let payload: { sub?: string };
  try {
    payload = await verifyToken(token, { secretKey });
  } catch {
    throw new AuthenticationError('Invalid or expired token');
  }

  if (!payload.sub) {
    throw new AuthenticationError('Invalid token: missing sub claim');
  }

  return { userId: payload.sub };
}
