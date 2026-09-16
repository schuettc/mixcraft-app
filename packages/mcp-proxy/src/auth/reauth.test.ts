import { describe, it, expect } from 'vitest';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { isAuthError, withReauth } from './reauth.js';

describe('isAuthError', () => {
  it('is true for a 401 from the transport', () => {
    expect(isAuthError(new StreamableHTTPError(401, 'Unauthorized'))).toBe(true);
  });

  it('is true for a 403 from the transport', () => {
    expect(isAuthError(new StreamableHTTPError(403, 'Forbidden'))).toBe(true);
  });

  it('is true for the SDK UnauthorizedError', () => {
    expect(isAuthError(new UnauthorizedError())).toBe(true);
  });

  it('is false for a non-auth transport error', () => {
    expect(isAuthError(new StreamableHTTPError(500, 'Server error'))).toBe(false);
  });

  it('is false for an ordinary error', () => {
    expect(isAuthError(new Error('boom'))).toBe(false);
  });
});

describe('withReauth', () => {
  it('returns the result and never re-auths when the call succeeds', async () => {
    let reauths = 0;
    const result = await withReauth(
      async () => 'ok',
      async () => {
        reauths++;
      },
    );

    expect(result).toBe('ok');
    expect(reauths).toBe(0);
  });

  it('propagates a non-auth error without re-authing', async () => {
    let reauths = 0;
    await expect(
      withReauth(
        async () => {
          throw new Error('network down');
        },
        async () => {
          reauths++;
        },
      ),
    ).rejects.toThrow('network down');
    expect(reauths).toBe(0);
  });

  it('re-auths once and retries after a 401, then succeeds', async () => {
    let attempts = 0;
    let reauths = 0;
    const result = await withReauth(
      async () => {
        attempts++;
        if (attempts === 1) throw new StreamableHTTPError(401, 'Unauthorized');
        return 'ok';
      },
      async () => {
        reauths++;
      },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
    expect(reauths).toBe(1);
  });

  it('re-auths at most once and stops hammering when the retry also 401s', async () => {
    let attempts = 0;
    let reauths = 0;
    await expect(
      withReauth(
        async () => {
          attempts++;
          throw new StreamableHTTPError(401, 'Unauthorized');
        },
        async () => {
          reauths++;
        },
      ),
    ).rejects.toBeInstanceOf(StreamableHTTPError);

    expect(attempts).toBe(2); // original + exactly one retry, never a storm
    expect(reauths).toBe(1);
  });
});
