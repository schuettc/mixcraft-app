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

import { acquireOAuthToken } from './cli.js';
import {
  loadCachedToken,
  saveCachedToken,
  isTokenExpired,
} from './auth/token-cache.js';
import { refreshAccessToken, loginViaBrowser } from './auth/oauth-login.js';

const mockLoadCachedToken = vi.mocked(loadCachedToken);
const mockIsTokenExpired = vi.mocked(isTokenExpired);
const mockRefreshAccessToken = vi.mocked(refreshAccessToken);
const mockLoginViaBrowser = vi.mocked(loginViaBrowser);
const mockSaveCachedToken = vi.mocked(saveCachedToken);

const config = {
  authorizeUrl: 'https://clerk.mixcraft.app/oauth/authorize',
  tokenUrl: 'https://clerk.mixcraft.app/oauth/token',
  clientId: 'client_123',
};

describe('acquireOAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MIXCRAFT_API_KEY;
  });

  it('returns the cached token when it is present and not expired', async () => {
    const cached = {
      accessToken: 'cached_access',
      refreshToken: 'cached_refresh',
      expiresAt: Date.now() + 3600_000,
    };
    mockLoadCachedToken.mockReturnValue(cached);
    mockIsTokenExpired.mockReturnValue(false);

    const token = await acquireOAuthToken(config);

    expect(token).toEqual(cached);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    expect(mockLoginViaBrowser).not.toHaveBeenCalled();
  });

  it('refreshes and persists an expired cached token', async () => {
    mockLoadCachedToken.mockReturnValue({
      accessToken: 'expired_access',
      refreshToken: 'valid_refresh',
      expiresAt: Date.now() - 1000,
    });
    mockIsTokenExpired.mockReturnValue(true);
    const refreshed = {
      accessToken: 'new_access',
      refreshToken: 'new_refresh',
      expiresAt: Date.now() + 3600_000,
    };
    mockRefreshAccessToken.mockResolvedValue(refreshed);

    const token = await acquireOAuthToken(config);

    expect(token).toEqual(refreshed);
    expect(mockSaveCachedToken).toHaveBeenCalledWith(refreshed);
    expect(mockLoginViaBrowser).not.toHaveBeenCalled();
  });

  it('falls back to browser login when refresh fails', async () => {
    mockLoadCachedToken.mockReturnValue({
      accessToken: 'expired_access',
      refreshToken: 'dead_refresh',
      expiresAt: Date.now() - 1000,
    });
    mockIsTokenExpired.mockReturnValue(true);
    mockRefreshAccessToken.mockRejectedValue(new Error('invalid_grant'));
    const fresh = {
      accessToken: 'login_access',
      refreshToken: 'login_refresh',
      expiresAt: Date.now() + 3600_000,
    };
    mockLoginViaBrowser.mockResolvedValue(fresh);

    const token = await acquireOAuthToken(config);

    expect(token).toEqual(fresh);
    expect(mockSaveCachedToken).toHaveBeenCalledWith(fresh);
  });

  it('logs in via browser when there is no cached token', async () => {
    mockLoadCachedToken.mockReturnValue(null);
    const fresh = {
      accessToken: 'login_access',
      refreshToken: 'login_refresh',
      expiresAt: Date.now() + 3600_000,
    };
    mockLoginViaBrowser.mockResolvedValue(fresh);

    const token = await acquireOAuthToken(config);

    expect(token).toEqual(fresh);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });
});
