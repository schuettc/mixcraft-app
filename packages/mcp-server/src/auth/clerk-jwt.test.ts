import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
}));
vi.mock('../shared/secrets.js', () => ({
  getSecret: vi.fn(),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { validateClerkJwt } from './clerk-jwt.js';
import { verifyToken } from '@clerk/backend';
import { getSecret } from '../shared/secrets.js';

const mockVerifyToken = vi.mocked(verifyToken);
const mockGetSecret = vi.mocked(getSecret);

describe('validateClerkJwt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSecret.mockResolvedValue('sk_test_fake_secret_key');
  });

  it('returns userId from valid session JWT', async () => {
    mockVerifyToken.mockResolvedValue({ sub: 'user_abc123' } as never);

    const result = await validateClerkJwt('eyJhbGciOi.valid.token');

    expect(result).toEqual({ userId: 'user_abc123' });
    expect(mockVerifyToken).toHaveBeenCalledWith('eyJhbGciOi.valid.token', {
      secretKey: 'sk_test_fake_secret_key',
    });
  });

  it('falls back to userinfo for OAuth access tokens', async () => {
    mockVerifyToken.mockRejectedValue(new Error('Not a session JWT'));
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user_id: 'user_oauth456', sub: 'user_oauth456' }),
    });

    const result = await validateClerkJwt('oauth-access-token');

    expect(result).toEqual({ userId: 'user_oauth456' });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/oauth/userinfo'),
      { headers: { Authorization: 'Bearer oauth-access-token' } },
    );
  });

  it('throws when both session JWT and userinfo fail', async () => {
    mockVerifyToken.mockRejectedValue(new Error('Not a session JWT'));
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    await expect(validateClerkJwt('bad-token')).rejects.toThrow(
      'Invalid or expired token',
    );
  });

  it('throws when userinfo returns no user identity', async () => {
    mockVerifyToken.mockRejectedValue(new Error('Not a session JWT'));
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ email: 'test@test.com' }),
    });

    await expect(validateClerkJwt('token-no-id')).rejects.toThrow(
      'Invalid token: missing user identity',
    );
  });
});

describe('validateClerkJwt upstream failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSecret.mockResolvedValue('sk_test_fake_secret_key');
    mockVerifyToken.mockRejectedValue(new Error('Not a session JWT'));
  });

  it.each([401, 403])(
    'treats userinfo %i as a rejected token',
    async (status) => {
      fetchMock.mockResolvedValue({ ok: false, status });

      await expect(validateClerkJwt('bad-token')).rejects.toMatchObject({
        name: 'AuthenticationError',
        message: 'Invalid or expired token',
        upstreamStatus: status,
      });
    },
  );

  it.each([429, 500, 502, 503])(
    'treats userinfo %i as an upstream provider failure',
    async (status) => {
      fetchMock.mockResolvedValue({ ok: false, status });

      await expect(validateClerkJwt('good-token')).rejects.toMatchObject({
        name: 'UpstreamAuthError',
        message: 'Auth provider unavailable',
        upstreamStatus: status,
      });
    },
  );

  it('treats a network failure as an upstream provider failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(validateClerkJwt('good-token')).rejects.toMatchObject({
      name: 'UpstreamAuthError',
      message: 'Auth provider unavailable',
    });
  });
});
