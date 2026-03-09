import { verifyToken } from '@clerk/backend';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? '';

export async function validateClerkSession(
  authHeader: string | undefined,
): Promise<{ userId: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7);

  const payload = await verifyToken(token, {
    secretKey: CLERK_SECRET_KEY,
  });

  if (!payload.sub) {
    throw new Error('Invalid token: missing sub claim');
  }

  return { userId: payload.sub };
}
