import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
}));
vi.mock('./secrets.js', () => ({
  getSecret: vi.fn().mockResolvedValue('test-clerk-secret'),
}));

import { validateClerkSession } from './clerk.js';
import { verifyToken } from '@clerk/backend';

describe('validateClerkSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws for undefined authHeader', async () => {
    await expect(validateClerkSession(undefined)).rejects.toThrow(
      'Missing or invalid Authorization header',
    );
  });

  it('throws for authHeader not starting with Bearer', async () => {
    await expect(validateClerkSession('Basic abc')).rejects.toThrow(
      'Missing or invalid Authorization header',
    );
  });

  it('throws when token has no sub claim', async () => {
    vi.mocked(verifyToken).mockResolvedValue({ sub: '' } as any);

    await expect(validateClerkSession('Bearer valid-token')).rejects.toThrow(
      'Invalid token: missing sub claim',
    );
  });

  it('returns { userId } for valid token', async () => {
    vi.mocked(verifyToken).mockResolvedValue({ sub: 'user-456' } as any);

    const result = await validateClerkSession('Bearer valid-token');
    expect(result).toEqual({ userId: 'user-456' });
  });

  it('extracts token correctly from Bearer header', async () => {
    vi.mocked(verifyToken).mockResolvedValue({ sub: 'user-789' } as any);

    await validateClerkSession('Bearer my-jwt-token');

    expect(verifyToken).toHaveBeenCalledWith('my-jwt-token', {
      secretKey: 'test-clerk-secret',
    });
  });
});
