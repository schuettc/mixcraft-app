import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

/**
 * True when an error means the server rejected our credential (HTTP 401/403),
 * as opposed to a network or server fault. Only these are worth re-authing for.
 */
export function isAuthError(err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    return true;
  }
  if (err instanceof StreamableHTTPError) {
    return err.code === 401 || err.code === 403;
  }
  return false;
}

/**
 * Runs `operation`. If it fails with an auth error, runs `reauth` once (which is
 * expected to refresh the credential the operation uses) and retries the
 * operation exactly once. A second auth failure propagates — we never loop, so a
 * dead token can't turn into a storm of rejected requests.
 */
export async function withReauth<T>(
  operation: () => Promise<T>,
  reauth: () => Promise<void>,
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (!isAuthError(err)) {
      throw err;
    }
    await reauth();
    return operation();
  }
}
