import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSpotifyAuthUrl, handleSpotifyCallback } from './spotify-oauth.js';
import { getSecret } from '../shared/secrets.js';
import { connectService } from './services.js';

vi.mock('../shared/secrets.js');
vi.mock('./services.js');

describe('spotify-oauth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SPOTIFY_CLIENT_ID_SECRET_NAME = 'client-id';
    process.env.SPOTIFY_CLIENT_SECRET_SECRET_NAME = 'client-secret';
    process.env.API_BASE_URL = 'https://api.test';
    global.fetch = vi.fn();
  });

  describe('getSpotifyAuthUrl', () => {
    it('returns a valid Spotify authorize URL', async () => {
      vi.mocked(getSecret).mockImplementation(async (name) => name);
      
      const result = await getSpotifyAuthUrl('user-123');
      const body = JSON.parse(result.body);
      
      expect(result.statusCode).toBe(200);
      expect(body.url).toContain('https://accounts.spotify.com/authorize');
      expect(body.url).toContain('client_id=client-id');
      expect(body.url).toContain('state=');
    });
  });

  describe('handleSpotifyCallback', () => {
    it('successfully handles valid code and state', async () => {
      vi.mocked(getSecret).mockImplementation(async (name) => name);
      
      // Need a valid state for the test
      const authResult = await getSpotifyAuthUrl('user-123');
      const url = new URL(JSON.parse(authResult.body).url);
      const state = url.searchParams.get('state')!;

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        }),
      } as Response);

      const result = await handleSpotifyCallback('valid-code', state);

      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('text/html');
      expect(result.body).toContain('Spotify connected');
      expect(connectService).toHaveBeenCalledWith('user-123', 'spotify', 'new-access', expect.objectContaining({
        refreshToken: 'new-refresh',
      }));
    });

    it('returns 400 for invalid state', async () => {
      vi.mocked(getSecret).mockImplementation(async (name) => name);
      const result = await handleSpotifyCallback('code', 'invalid-state');
      expect(result.statusCode).toBe(400);
    });

    it('returns 500 if token exchange fails', async () => {
      vi.mocked(getSecret).mockImplementation(async (name) => name);
      const authResult = await getSpotifyAuthUrl('user-123');
      const state = new URL(JSON.parse(authResult.body).url).searchParams.get('state')!;

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        text: async () => 'Exchange error',
      } as Response);

      const result = await handleSpotifyCallback('code', state);
      expect(result.statusCode).toBe(500);
    });
  });
});
