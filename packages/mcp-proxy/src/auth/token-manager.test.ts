import { describe, it, expect, vi } from 'vitest';
import {
  TokenManager,
  NeedsReauthError,
  type TokenState,
} from './token-manager.js';

const NOW = 1_000_000_000_000;

function state(over: Partial<TokenState> = {}): TokenState {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: NOW + 3600_000,
    ...over,
  };
}

function nextState(n: number): TokenState {
  return {
    accessToken: `access-${n}`,
    refreshToken: `refresh-${n}`,
    expiresAt: NOW + 3600_000,
  };
}

describe('TokenManager.getToken (proactive)', () => {
  it('returns the current token without refreshing when it is not near expiry', async () => {
    const refresh = vi.fn();
    const mgr = new TokenManager({ initial: state(), refresh, now: () => NOW });

    expect(await mgr.getToken()).toBe('access-1');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes proactively when the token is within the expiry buffer, and saves it', async () => {
    const refresh = vi.fn(async () => nextState(2));
    const save = vi.fn();
    const mgr = new TokenManager({
      initial: state({ expiresAt: NOW + 30_000 }), // 30s left, inside 60s buffer
      refresh,
      save,
      now: () => NOW,
      expiryBufferMs: 60_000,
    });

    expect(await mgr.getToken()).toBe('access-2');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('refresh-1');
    expect(save).toHaveBeenCalledWith(nextState(2));
  });

  it('coalesces concurrent refreshes into a single refresh call (single-flight)', async () => {
    let resolve!: (t: TokenState) => void;
    const refresh = vi.fn(
      () => new Promise<TokenState>((r) => (resolve = r)),
    );
    const mgr = new TokenManager({
      initial: state({ expiresAt: NOW - 1 }), // already expired
      refresh,
      now: () => NOW,
    });

    const a = mgr.getToken();
    const b = mgr.getToken();
    resolve(nextState(2));

    expect(await a).toBe('access-2');
    expect(await b).toBe('access-2');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('TokenManager.refreshAfter401 (reactive)', () => {
  it('refreshes when the failed token is still the current one', async () => {
    const refresh = vi.fn(async () => nextState(2));
    const mgr = new TokenManager({ initial: state(), refresh, now: () => NOW });

    expect(await mgr.refreshAfter401('access-1')).toBe('access-2');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does NOT refresh again when another caller already refreshed (anti-stampede)', async () => {
    const refresh = vi.fn(async () => nextState(2));
    const mgr = new TokenManager({ initial: state(), refresh, now: () => NOW });

    // First 401 rotates access-1 -> access-2.
    await mgr.refreshAfter401('access-1');
    refresh.mockClear();

    // A concurrent request that also saw a 401 on the OLD token must not
    // trigger a second refresh — it gets the already-rotated token.
    expect(await mgr.refreshAfter401('access-1')).toBe('access-2');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('coalesces a burst of concurrent 401s on the same token into one refresh', async () => {
    let resolve!: (t: TokenState) => void;
    const refresh = vi.fn(
      () => new Promise<TokenState>((r) => (resolve = r)),
    );
    const mgr = new TokenManager({ initial: state(), refresh, now: () => NOW });

    const calls = Array.from({ length: 7 }, () =>
      mgr.refreshAfter401('access-1'),
    );
    resolve(nextState(2));
    const results = await Promise.all(calls);

    expect(results.every((t) => t === 'access-2')).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('TokenManager dead-session handling', () => {
  it('marks the session dead on a permanent refresh failure and stops calling refresh', async () => {
    const refresh = vi.fn(async () => {
      throw Object.assign(new Error('invalid_grant'), { status: 400 });
    });
    const mgr = new TokenManager({ initial: state(), refresh, now: () => NOW });

    await expect(mgr.refreshAfter401('access-1')).rejects.toBeInstanceOf(
      NeedsReauthError,
    );
    expect(refresh).toHaveBeenCalledTimes(1);

    // Subsequent calls fail fast without hitting the network again.
    await expect(mgr.getToken()).rejects.toBeInstanceOf(NeedsReauthError);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does NOT mark the session dead on a transient refresh failure', async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('gateway'), { status: 502 }))
      .mockResolvedValueOnce(nextState(2));
    const mgr = new TokenManager({
      initial: state({ expiresAt: NOW - 1 }),
      refresh,
      now: () => NOW,
    });

    await expect(mgr.getToken()).rejects.toThrow('gateway');
    // A later call is allowed to retry — the session is not permanently dead.
    expect(await mgr.getToken()).toBe('access-2');
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
