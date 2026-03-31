import { validateApiKey } from './api-key.js';
import { validateClerkJwt } from './clerk-jwt.js';

const API_KEY_PREFIX = 'mx_';

export interface AuthResult {
  userId: string;
  authMethod: 'api_key' | 'clerk_oauth';
  deprecated: boolean;
}

export async function authenticate(token: string): Promise<AuthResult> {
  if (token.startsWith(API_KEY_PREFIX)) {
    const { userId } = await validateApiKey(token);
    return { userId, authMethod: 'api_key', deprecated: true };
  }

  const { userId } = await validateClerkJwt(token);
  return { userId, authMethod: 'clerk_oauth', deprecated: false };
}
