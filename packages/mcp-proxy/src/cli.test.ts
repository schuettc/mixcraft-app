import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./auth/token-cache.js', () => ({
  loadCachedToken: vi.fn(),
  saveCachedToken: vi.fn(),
  isTokenExpired: vi.fn(),
}));
vi.mock('./auth/oauth-login.js', () => ({
  refreshAccessToken: vi.fn(),
  loginViaBrowser: vi.fn(),
}));

import { resolveToken } from './cli.js';
import { loadCachedToken, isTokenExpired } from './auth/token-cache.js';
import { refreshAccessToken } from './auth/oauth-login.js';

const mockLoadCachedToken = vi.mocked(loadCachedToken);
const mockIsTokenExpired = vi.mocked(isTokenExpired);
const mockRefreshAccessToken = vi.mocked(refreshAccessToken);

describe('resolveToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MIXCRAFT_API_KEY;
  });

  it('uses MIXCRAFT_API_KEY with deprecation warning when set', async () => {
    process.env.MIXCRAFT_API_KEY = 'mx_test_key_here';
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const token = await resolveToken({
      authorizeUrl: 'https://clerk.mixcraft.app/oauth/authorize',
      tokenUrl: 'https://clerk.mixcraft.app/oauth/token',
      clientId: 'client_123',
    });

    expect(token).toBe('mx_test_key_here');
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('deprecated'),
    );
    stderrSpy.mockRestore();
  });

  it('uses cached token when available and not expired', async () => {
    const cached = {
      accessToken: 'cached_access',
      refreshToken: 'cached_refresh',
      expiresAt: Date.now() + 3600_000,
    };
    mockLoadCachedToken.mockReturnValue(cached);
    mockIsTokenExpired.mockReturnValue(false);

    const token = await resolveToken({
      authorizeUrl: 'https://clerk.mixcraft.app/oauth/authorize',
      tokenUrl: 'https://clerk.mixcraft.app/oauth/token',
      clientId: 'client_123',
    });

    expect(token).toBe('cached_access');
  });

  it('refreshes expired cached token', async () => {
    const cached = {
      accessToken: 'expired_access',
      refreshToken: 'valid_refresh',
      expiresAt: Date.now() - 1000,
    };
    mockLoadCachedToken.mockReturnValue(cached);
    mockIsTokenExpired.mockReturnValue(true);
    mockRefreshAccessToken.mockResolvedValue({
      accessToken: 'new_access',
      refreshToken: 'new_refresh',
      expiresAt: Date.now() + 3600_000,
    });

    const token = await resolveToken({
      authorizeUrl: 'https://clerk.mixcraft.app/oauth/authorize',
      tokenUrl: 'https://clerk.mixcraft.app/oauth/token',
      clientId: 'client_123',
    });

    expect(token).toBe('new_access');
  });
});
