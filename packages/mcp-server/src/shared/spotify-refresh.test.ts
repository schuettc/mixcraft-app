import { describe, it, expect, vi, beforeEach } from 'vitest';
import { refreshSpotifyToken } from './spotify-refresh.js';
import { getSecret } from './secrets.js';
import { getUserTokens, storeUserTokens } from './token-manager.js';

vi.mock('./secrets.js');
vi.mock('./token-manager.js');

describe('spotify-refresh', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SPOTIFY_CLIENT_ID_SECRET_NAME = 'client-id';
    process.env.SPOTIFY_CLIENT_SECRET_SECRET_NAME = 'client-secret';
    global.fetch = vi.fn();
  });

  it('successfully refreshes token', async () => {
    vi.mocked(getUserTokens).mockResolvedValue({
      kind: 'spotify',
      accessToken: 'old-access',
      refreshToken: 'valid-refresh',
      expiresAt: Date.now() - 1000,
    });
    vi.mocked(getSecret).mockImplementation(async (name) => name);
    
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }),
    } as Response);

    const result = await refreshSpotifyToken('user-123');

    expect(result).not.toBeNull();
    expect(result?.accessToken).toBe('new-access');
    expect(result?.refreshToken).toBe('new-refresh');
    expect(storeUserTokens).toHaveBeenCalledWith('user-123', 'spotify', expect.objectContaining({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    }));
  });

  it('returns null if no tokens found', async () => {
    vi.mocked(getUserTokens).mockResolvedValue(null);
    const result = await refreshSpotifyToken('user-123');
    expect(result).toBeNull();
  });

  it('returns null if no refresh token available', async () => {
    vi.mocked(getUserTokens).mockResolvedValue({
      kind: 'spotify',
      accessToken: 'access',
      refreshToken: '',
      expiresAt: 0,
    });
    const result = await refreshSpotifyToken('user-123');
    expect(result).toBeNull();
  });

  it('returns null if Spotify API fails', async () => {
    vi.mocked(getUserTokens).mockResolvedValue({
      kind: 'spotify',
      accessToken: 'old-access',
      refreshToken: 'valid-refresh',
      expiresAt: 0,
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      text: async () => 'Internal Server Error',
    } as Response);

    const result = await refreshSpotifyToken('user-123');
    expect(result).toBeNull();
  });
});
