import { getOAuthTokenForProvider } from '../shared/clerk-oauth.js';
import { connectService } from './services.js';

/**
 * Sync a music service token from Clerk's OAuth storage into our DynamoDB.
 * Called after social login to auto-connect the matching music service.
 */
export async function syncFromClerk(
  userId: string,
  provider: string,
): Promise<{ statusCode: number; body: string }> {
  const token = await getOAuthTokenForProvider(userId, provider);

  if (!token) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        synced: false,
        reason: 'No OAuth token found for this provider in Clerk',
      }),
    };
  }

  const result = await connectService(userId, provider, token);

  if (result.statusCode !== 200) {
    return result;
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ synced: true }),
  };
}
