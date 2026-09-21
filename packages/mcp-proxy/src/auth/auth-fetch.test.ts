import { describe, it, expect, vi } from 'vitest';
import { createAuthFetch, type TokenSource } from './auth-fetch.js';

const URL_ = 'https://mcp.mixcraft.app/mcp';

function authOf(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get('authorization');
}

describe('createAuthFetch', () => {
  it('stamps the current token as a Bearer header and passes the request through', async () => {
    const source: TokenSource = {
      getToken: vi.fn(async () => 'tok-A'),
      refreshAfter401: vi.fn(),
    };
    const realFetch = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response('ok', { status: 200 }),
    );

    const authFetch = createAuthFetch(source, realFetch);
    const res = await authFetch(URL_, { method: 'POST', body: '{}' });

    expect(res.status).toBe(200);
    expect(realFetch).toHaveBeenCalledTimes(1);
    const init = realFetch.mock.calls[0][1];
    expect(authOf(init)).toBe('Bearer tok-A');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
    expect(source.refreshAfter401).not.toHaveBeenCalled();
  });

  it('does not refresh on a non-401 error response', async () => {
    const source: TokenSource = {
      getToken: vi.fn(async () => 'tok-A'),
      refreshAfter401: vi.fn(),
    };
    const realFetch = vi.fn(async () => new Response('boom', { status: 500 }));

    const res = await createAuthFetch(source, realFetch)(URL_);

    expect(res.status).toBe(500);
    expect(source.refreshAfter401).not.toHaveBeenCalled();
    expect(realFetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes and retries once with the new token after a 401', async () => {
    const source: TokenSource = {
      getToken: vi.fn(async () => 'tok-A'),
      refreshAfter401: vi.fn(async () => 'tok-B'),
    };
    const realFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('no', { status: 401 }))
      .mockResolvedValueOnce(new Response('yes', { status: 200 }));

    const res = await createAuthFetch(source, realFetch)(URL_);

    expect(res.status).toBe(200);
    expect(source.refreshAfter401).toHaveBeenCalledWith('tok-A');
    expect(realFetch).toHaveBeenCalledTimes(2);
    expect(authOf(realFetch.mock.calls[0][1])).toBe('Bearer tok-A');
    expect(authOf(realFetch.mock.calls[1][1])).toBe('Bearer tok-B');
  });

  it('returns the 401 without retrying when the refresh yields the same token', async () => {
    const source: TokenSource = {
      getToken: vi.fn(async () => 'tok-A'),
      refreshAfter401: vi.fn(async () => 'tok-A'),
    };
    const realFetch = vi.fn(async () => new Response('no', { status: 401 }));

    const res = await createAuthFetch(source, realFetch)(URL_);

    expect(res.status).toBe(401);
    expect(realFetch).toHaveBeenCalledTimes(1);
  });

  it('propagates a re-auth failure and does not retry', async () => {
    const source: TokenSource = {
      getToken: vi.fn(async () => 'tok-A'),
      refreshAfter401: vi.fn(async () => {
        throw new Error('needs reauth');
      }),
    };
    const realFetch = vi.fn(async () => new Response('no', { status: 401 }));

    await expect(createAuthFetch(source, realFetch)(URL_)).rejects.toThrow(
      'needs reauth',
    );
    expect(realFetch).toHaveBeenCalledTimes(1);
  });
});
