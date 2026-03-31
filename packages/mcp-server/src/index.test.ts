import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies the handler imports
vi.mock('./auth/api-key.js', () => ({
  validateApiKey: vi.fn(),
}));
vi.mock('./auth/clerk-jwt.js', () => ({
  validateClerkJwt: vi.fn(),
}));
vi.mock('./shared/token-manager.js', () => ({
  getConnectedServices: vi.fn().mockResolvedValue(new Map()),
  storeUserTokens: vi.fn(),
}));
vi.mock('./services/apple-music/jwt.js', () => ({
  generateDeveloperToken: vi.fn(),
}));
vi.mock('./services/apple-music/adapter.js', () => ({
  AppleMusicAdapter: vi.fn(),
}));
vi.mock('./services/spotify/adapter.js', () => ({
  SpotifyAdapter: vi.fn(),
}));
vi.mock('./shared/spotify-refresh.js', () => ({
  refreshSpotifyToken: vi.fn(),
}));

import { handler } from './index.js';

describe('handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLERK_OAUTH_AUTHORIZE_URL = 'https://clerk.mixcraft.app/oauth/authorize';
    process.env.CLERK_OAUTH_TOKEN_URL = 'https://clerk.mixcraft.app/oauth/token';
  });

  it('returns OAuth metadata for GET /.well-known/oauth-authorization-server', async () => {
    const event = {
      requestContext: {
        http: { method: 'GET', path: '/.well-known/oauth-authorization-server' },
        requestId: 'test-req',
      },
      headers: {},
    };

    const result = await handler(event as never);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.issuer).toBe('https://clerk.mixcraft.app');
    expect(body.authorization_endpoint).toBe('https://clerk.mixcraft.app/oauth/authorize');
    expect(body.token_endpoint).toBe('https://clerk.mixcraft.app/oauth/token');
    expect(body.response_types_supported).toEqual(['code']);
    expect(body.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
  });
});
