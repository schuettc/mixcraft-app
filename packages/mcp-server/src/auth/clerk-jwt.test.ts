import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
}));
vi.mock('../shared/secrets.js', () => ({
  getSecret: vi.fn(),
}));

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

  it('returns userId from valid JWT sub claim', async () => {
    mockVerifyToken.mockResolvedValue({ sub: 'user_abc123' } as never);

    const result = await validateClerkJwt('eyJhbGciOi.valid.token');

    expect(result).toEqual({ userId: 'user_abc123' });
    expect(mockVerifyToken).toHaveBeenCalledWith('eyJhbGciOi.valid.token', {
      secretKey: 'sk_test_fake_secret_key',
    });
  });

  it('throws AuthenticationError when sub claim is missing', async () => {
    mockVerifyToken.mockResolvedValue({ sub: undefined } as never);

    await expect(validateClerkJwt('token-no-sub')).rejects.toThrow(
      'Invalid token: missing sub claim',
    );
  });

  it('throws AuthenticationError when verifyToken rejects', async () => {
    mockVerifyToken.mockRejectedValue(new Error('Token expired'));

    await expect(validateClerkJwt('expired-token')).rejects.toThrow(
      'Invalid or expired token',
    );
  });
});
