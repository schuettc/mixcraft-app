import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./clerk-jwt.js', () => ({
  validateClerkJwt: vi.fn(),
}));
vi.mock('./api-key.js', () => ({
  validateApiKey: vi.fn(),
}));

import { authenticate } from './index.js';
import { validateClerkJwt } from './clerk-jwt.js';
import { validateApiKey } from './api-key.js';

const mockValidateClerkJwt = vi.mocked(validateClerkJwt);
const mockValidateApiKey = vi.mocked(validateApiKey);

describe('authenticate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses API key validation for mx_ prefixed tokens', async () => {
    mockValidateApiKey.mockResolvedValue({
      userId: 'user_123',
      keyPrefix: 'mx_abc',
      name: 'test-key',
    });

    const result = await authenticate('mx_abcdef1234567890abcdef1234567890');

    expect(result.userId).toBe('user_123');
    expect(result.authMethod).toBe('api_key');
    expect(result.deprecated).toBe(true);
    expect(mockValidateApiKey).toHaveBeenCalled();
    expect(mockValidateClerkJwt).not.toHaveBeenCalled();
  });

  it('uses Clerk JWT validation for non-mx_ tokens', async () => {
    mockValidateClerkJwt.mockResolvedValue({ userId: 'user_456' });

    const result = await authenticate('eyJhbGciOiJSUzI1NiIs.jwt.token');

    expect(result.userId).toBe('user_456');
    expect(result.authMethod).toBe('clerk_oauth');
    expect(result.deprecated).toBe(false);
    expect(mockValidateClerkJwt).toHaveBeenCalled();
    expect(mockValidateApiKey).not.toHaveBeenCalled();
  });

  it('throws when API key validation fails', async () => {
    mockValidateApiKey.mockRejectedValue(new Error('Invalid API key'));

    await expect(
      authenticate('mx_invalid_key_here_padding_to_len'),
    ).rejects.toThrow('Invalid API key');
  });

  it('throws when JWT validation fails', async () => {
    mockValidateClerkJwt.mockRejectedValue(new Error('Invalid or expired token'));

    await expect(authenticate('bad.jwt.token')).rejects.toThrow(
      'Invalid or expired token',
    );
  });
});
