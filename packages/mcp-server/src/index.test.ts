import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies the handler imports
vi.mock('./auth/index.js', () => ({
  authenticate: vi.fn(),
}));
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
import { authenticate } from './auth/index.js';

const mockAuthenticate = vi.mocked(authenticate);

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

  it('adds deprecation header when authenticated via API key', async () => {
    mockAuthenticate.mockResolvedValue({
      userId: 'user_123',
      authMethod: 'api_key',
      deprecated: true,
    });

    const event = {
      requestContext: {
        http: { method: 'POST', path: '/mcp' },
        requestId: 'test-req',
      },
      headers: { authorization: 'Bearer mx_test_key_here_pad_to_length' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      isBase64Encoded: false,
    };

    const result = await handler(event as never);

    expect(result.headers?.['X-Mixcraft-Deprecation']).toContain('API keys');
  });

  it('does not add deprecation header when authenticated via OAuth', async () => {
    mockAuthenticate.mockResolvedValue({
      userId: 'user_456',
      authMethod: 'clerk_oauth',
      deprecated: false,
    });

    const event = {
      requestContext: {
        http: { method: 'POST', path: '/mcp' },
        requestId: 'test-req',
      },
      headers: { authorization: 'Bearer eyJhbGciOi.jwt.token' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      isBase64Encoded: false,
    };

    const result = await handler(event as never);

    expect(result.headers?.['X-Mixcraft-Deprecation']).toBeUndefined();
  });
});
