import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  RefreshError,
} from './oauth-login.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('oauth-login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildAuthorizationUrl', () => {
    it('builds correct authorization URL with PKCE params', () => {
      const result = buildAuthorizationUrl({
        authorizeUrl: 'https://clerk.mixcraft.app/oauth/authorize',
        clientId: 'client_123',
        redirectUri: 'http://localhost:8888/callback',
        codeVerifier: 'test-verifier',
      });

      const url = new URL(result.url);
      expect(url.origin + url.pathname).toBe(
        'https://clerk.mixcraft.app/oauth/authorize',
      );
      expect(url.searchParams.get('client_id')).toBe('client_123');
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8888/callback');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      expect(url.searchParams.get('scope')).toContain('offline_access');
    });
  });

  describe('exchangeCodeForToken', () => {
    it('exchanges authorization code for tokens', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'access_123',
            refresh_token: 'refresh_456',
            expires_in: 3600,
          }),
      });

      const result = await exchangeCodeForToken({
        tokenUrl: 'https://clerk.mixcraft.app/oauth/token',
        clientId: 'client_123',
        code: 'auth_code_here',
        redirectUri: 'http://localhost:8888/callback',
        codeVerifier: 'test-verifier',
      });

      expect(result.accessToken).toBe('access_123');
      expect(result.refreshToken).toBe('refresh_456');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('throws when token exchange fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('invalid_grant'),
      });

      await expect(
        exchangeCodeForToken({
          tokenUrl: 'https://clerk.mixcraft.app/oauth/token',
          clientId: 'client_123',
          code: 'bad_code',
          redirectUri: 'http://localhost:8888/callback',
          codeVerifier: 'test-verifier',
        }),
      ).rejects.toThrow('Token exchange failed');
    });
  });

  describe('refreshAccessToken', () => {
    it('returns the rotated token state on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new_access',
            refresh_token: 'new_refresh',
            expires_in: 3600,
          }),
      });

      const result = await refreshAccessToken({
        tokenUrl: 'https://clerk.mixcraft.app/oauth/token',
        clientId: 'client_123',
        refreshToken: 'old_refresh',
      });

      expect(result.accessToken).toBe('new_access');
      expect(result.refreshToken).toBe('new_refresh');
    });

    it('throws a RefreshError carrying the HTTP status on a rejected refresh token', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('invalid_grant'),
      });

      const err = await refreshAccessToken({
        tokenUrl: 'https://clerk.mixcraft.app/oauth/token',
        clientId: 'client_123',
        refreshToken: 'dead_refresh',
      }).catch((e) => e);

      expect(err).toBeInstanceOf(RefreshError);
      expect(err.status).toBe(400);
    });

    it('throws a RefreshError with no status on a network failure', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      const err = await refreshAccessToken({
        tokenUrl: 'https://clerk.mixcraft.app/oauth/token',
        clientId: 'client_123',
        refreshToken: 'old_refresh',
      }).catch((e) => e);

      expect(err).toBeInstanceOf(RefreshError);
      expect(err.status).toBeUndefined();
    });
  });
});
