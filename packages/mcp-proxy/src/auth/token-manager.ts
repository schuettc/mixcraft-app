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
  // The access token the server has rejected; force a refresh before handing it
  // out again so a burst of requests doesn't each re-send a known-bad token.
  private poisonedToken: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: TokenManagerOptions) {
    this.state = opts.initial;
    this.refresh = opts.refresh;
    this.save = opts.save;
    this.now = opts.now ?? Date.now;
    // Refresh well ahead of expiry: the server can reject a token before our
    // cached expiry (shorter real TTL, clock skew), so leave a wide margin.
    this.buffer = opts.expiryBufferMs ?? 300_000;
  }

  private refreshOnce(): Promise<string> {
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      try {
        const next = await this.refresh(this.state.refreshToken);
        this.state = next;
        this.poisonedToken = null;
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
    const poisoned = this.state.accessToken === this.poisonedToken;
    if (!poisoned && this.now() < this.state.expiresAt - this.buffer) {
      return this.state.accessToken;
    }
    return this.refreshOnce();
  }

  /**
   * Record that the server rejected `token` (a 401). If it is still the current
   * token, the next `getToken()` refreshes instead of handing it out again.
   */
  reportRejected(token: string): void {
    if (this.state.accessToken === token) {
      this.poisonedToken = token;
    }
  }

  /**
   * Begin refreshing in the background so the token is renewed ahead of expiry
   * even while the session is idle. The timer is unref'd so it never keeps the
   * process alive. Safe to call once; use `stop()` to cancel.
   */
  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.getToken().catch(() => {});
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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
