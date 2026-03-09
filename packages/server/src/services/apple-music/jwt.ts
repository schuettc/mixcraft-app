import jwt from 'jsonwebtoken';
import { getSecret } from '../../shared/secrets.js';

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/** Buffer before expiry to trigger regeneration (5 minutes). */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/** Token lifetime: 2 hours. */
const TOKEN_LIFETIME_SECONDS = 3600 * 2;

export async function generateDeveloperToken(): Promise<string> {
  const now = Date.now();

  if (cachedToken && now < tokenExpiresAt - EXPIRY_BUFFER_MS) {
    return cachedToken;
  }

  const [teamId, keyId, privateKey] = await Promise.all([
    getSecret(process.env.APPLE_TEAM_ID_SECRET_NAME!),
    getSecret(process.env.APPLE_KEY_ID_SECRET_NAME!),
    getSecret(process.env.APPLE_PRIVATE_KEY_SECRET_NAME!),
  ]);

  const nowSeconds = Math.floor(now / 1000);
  const payload = {
    iss: teamId,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
  };
  const header = { alg: 'ES256' as const, kid: keyId };

  cachedToken = jwt.sign(payload, privateKey, {
    algorithm: 'ES256',
    header,
  });
  tokenExpiresAt = now + TOKEN_LIFETIME_SECONDS * 1000;

  return cachedToken;
}
