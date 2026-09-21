export interface TokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Thrown when the session can no longer be refreshed (the refresh token was
 * rejected). The caller should surface this and stop — the user must sign in
 * again — rather than retry, which only hammers the server with a dead token.
 */
export class NeedsReauthError extends Error {
  constructor(
    message = 'MixCraft session expired and could not be refreshed. Restart the client to sign in again.',
  ) {
    super(message);
    this.name = 'NeedsReauthError';
  }
}

export interface TokenManagerOptions {
  initial: TokenState;
  refresh: (refreshToken: string) => Promise<TokenState>;
  save?: (token: TokenState) => void;
  now?: () => number;
  expiryBufferMs?: number;
}

// A refresh failure with one of these HTTP statuses means the refresh token
// itself was rejected — retrying cannot help, so the session is dead. Anything
// else (5xx, network error, no status) is treated as transient.
function isPermanentFailure(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 400 || status === 401 || status === 403;
}

/**
 * Owns the OAuth token for a long-lived proxy session.
 *
 * - `getToken()` refreshes *before* the token expires (proactive), so a live
 *   token is never sent to the server and routine expiries generate no 401s.
 * - `refreshAfter401()` refreshes *after* the server rejects a token, but only
 *   if no one else already did — so a burst of concurrent 401s triggers exactly
 *   one refresh instead of a stampede that would trip refresh-token rotation.
 *
 * Both paths share a single in-flight refresh, and a permanently-rejected
 * refresh token marks the session dead so it fails fast instead of looping.
 */
export class TokenManager {
  private state: TokenState;
  private readonly refresh: (refreshToken: string) => Promise<TokenState>;
  private readonly save?: (token: TokenState) => void;
  private readonly now: () => number;
  private readonly buffer: number;
  private inflight: Promise<string> | null = null;
  private dead = false;

  constructor(opts: TokenManagerOptions) {
    this.state = opts.initial;
    this.refresh = opts.refresh;
    this.save = opts.save;
    this.now = opts.now ?? Date.now;
    this.buffer = opts.expiryBufferMs ?? 60_000;
  }

  private refreshOnce(): Promise<string> {
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      try {
        const next = await this.refresh(this.state.refreshToken);
        this.state = next;
        this.save?.(next);
        return next.accessToken;
      } catch (err) {
        if (isPermanentFailure(err)) {
          this.dead = true;
          throw new NeedsReauthError();
        }
        throw err;
      } finally {
        this.inflight = null;
      }
    })();

    return this.inflight;
  }

  async getToken(): Promise<string> {
    if (this.dead) throw new NeedsReauthError();
    if (this.now() < this.state.expiresAt - this.buffer) {
      return this.state.accessToken;
    }
    return this.refreshOnce();
  }

  async refreshAfter401(usedToken: string): Promise<string> {
    if (this.dead) throw new NeedsReauthError();
    // Another concurrent caller already rotated the token — use theirs rather
    // than refreshing again with an already-consumed refresh token.
    if (this.state.accessToken !== usedToken) {
      return this.state.accessToken;
    }
    return this.refreshOnce();
  }
}
