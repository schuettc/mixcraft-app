import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';

export interface TokenSource {
  /** A currently-valid token (refreshed proactively if near expiry). */
  getToken(): Promise<string>;
  /** Refresh after the server rejected `usedToken`; returns the token to retry with. */
  refreshAfter401(usedToken: string): Promise<string>;
}

function withAuth(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  return { ...init, headers };
}

/**
 * A `fetch` for the MCP transport that carries the OAuth token from `source`
 * and, on a 401, refreshes once and retries the request with the new token.
 * The token is stamped per-request rather than baked into a static header, so a
 * mid-session refresh takes effect without rebuilding the transport.
 */
export function createAuthFetch(
  source: TokenSource,
  realFetch: FetchLike = fetch,
): FetchLike {
  return async (url, init) => {
    const token = await source.getToken();
    const res = await realFetch(url, withAuth(init, token));
    if (res.status !== 401) return res;

    const fresh = await source.refreshAfter401(token);
    if (fresh === token) return res;

    return realFetch(url, withAuth(init, fresh));
  };
}
