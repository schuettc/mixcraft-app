import { verifyToken } from '@clerk/backend';
import { getSecret } from './secrets.js';

let cachedClerkKey: string | null = null;

async function getClerkSecretKey(): Promise<string> {
  if (cachedClerkKey) return cachedClerkKey;
  cachedClerkKey = await getSecret(process.env.CLERK_SECRET_KEY_NAME!);
  return cachedClerkKey;
}

export async function validateClerkSession(
  authHeader: string | undefined,
): Promise<{ userId: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7);
  const secretKey = await getClerkSecretKey();

  const payload = await verifyToken(token, {
    secretKey,
  });

  if (!payload.sub) {
    throw new Error('Invalid token: missing sub claim');
  }

  return { userId: payload.sub };
}
