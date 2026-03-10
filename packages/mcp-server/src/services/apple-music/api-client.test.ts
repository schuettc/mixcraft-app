import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { appleMusicFetch, APPLE_MUSIC_API_BASE } from './api-client.js';
import { RateLimitError, MusicServiceError } from '../../shared/errors.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(status: number, body?: unknown, headers?: Record<string, string>): Response {
  const headersObj = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(body ? JSON.stringify(body) : ''),
  } as unknown as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('appleMusicFetch', () => {
  it('prepends APPLE_MUSIC_API_BASE for relative endpoints', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, { data: [] }));

    await appleMusicFetch('/me/library/playlists', 'dev-token');

    expect(mockFetch).toHaveBeenCalledWith(
      `${APPLE_MUSIC_API_BASE}/me/library/playlists`,
      expect.any(Object),
    );
  });

  it('uses full URL for absolute endpoints', async () => {
    const fullUrl = 'https://api.music.apple.com/v1/catalog/us/songs/123';
    mockFetch.mockResolvedValueOnce(makeResponse(200, { data: [] }));

    await appleMusicFetch(fullUrl, 'dev-token');

    expect(mockFetch).toHaveBeenCalledWith(fullUrl, expect.any(Object));
  });

  it('sets Authorization header with Bearer token', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, { data: [] }));

    await appleMusicFetch('/endpoint', 'my-dev-token');

    const callHeaders = mockFetch.mock.calls[0][1].headers as Headers;
    expect(callHeaders.get('Authorization')).toBe('Bearer my-dev-token');
  });

  it('sets Music-User-Token header when provided', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, { data: [] }));

    await appleMusicFetch('/endpoint', 'dev-token', 'user-token-123');

    const callHeaders = mockFetch.mock.calls[0][1].headers as Headers;
    expect(callHeaders.get('Music-User-Token')).toBe('user-token-123');
  });

  it('does not set Music-User-Token when not provided', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, { data: [] }));

    await appleMusicFetch('/endpoint', 'dev-token');

    const callHeaders = mockFetch.mock.calls[0][1].headers as Headers;
    expect(callHeaders.get('Music-User-Token')).toBeNull();
  });

  it('returns null for 204 responses', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(204));

    const result = await appleMusicFetch('/endpoint', 'dev-token');
    expect(result).toBeNull();
  });

  it('retries on 429 responses up to MAX_RETRIES=3', async () => {
    // 4 calls total: initial + 3 retries, then throws
    for (let i = 0; i < 4; i++) {
      mockFetch.mockResolvedValueOnce(makeResponse(429, null, {}));
    }

    const promise = appleMusicFetch('/endpoint', 'dev-token');
    // Attach a catch so Node doesn't report unhandled rejection
    promise.catch(() => {});

    // Advance through all retry backoffs: 1s, 2s, 4s
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);

    await expect(promise).rejects.toThrow(RateLimitError);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('respects Retry-After header on 429', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(429, null, { 'Retry-After': '5' }))
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));

    const promise = appleMusicFetch('/endpoint', 'dev-token');

    // First retry backoff is 1s (INITIAL_BACKOFF_MS * 2^0)
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws RateLimitError after exhausting retries on 429', async () => {
    for (let i = 0; i < 4; i++) {
      mockFetch.mockResolvedValueOnce(makeResponse(429));
    }

    const promise = appleMusicFetch('/endpoint', 'dev-token');
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);

    await expect(promise).rejects.toThrow(RateLimitError);
  });

  it('throws MusicServiceError for non-ok responses', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(403, 'Forbidden'));

    await expect(appleMusicFetch('/endpoint', 'dev-token')).rejects.toThrow(
      MusicServiceError,
    );
    await expect(
      (async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(403, 'Forbidden'));
        await appleMusicFetch('/endpoint', 'dev-token');
      })(),
    ).rejects.toThrow(/403/);
  });

  it('parses and returns JSON for successful responses', async () => {
    const payload = { results: { songs: { data: [] } } };
    mockFetch.mockResolvedValueOnce(makeResponse(200, payload));

    const result = await appleMusicFetch('/endpoint', 'dev-token');
    expect(result).toEqual(payload);
  });
});
