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
vi.mock('./shared/clerk-spotify.js', () => ({
  getSpotifyTokenFromClerk: vi.fn(),
}));

import { handler } from './index.js';
import { authenticate } from './auth/index.js';
import { SpotifyAdapter } from './services/spotify/adapter.js';
import { getSpotifyTokenFromClerk } from './shared/clerk-spotify.js';
import { AuthenticationError, UpstreamAuthError } from './shared/errors.js';

const mockAuthenticate = vi.mocked(authenticate);
const mockGetSpotifyTokenFromClerk = vi.mocked(getSpotifyTokenFromClerk);
const mockSpotifyAdapter = vi.mocked(SpotifyAdapter);

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

  describe('ENABLE_SPOTIFY flag', () => {
    const event = {
      requestContext: {
        http: { method: 'POST', path: '/mcp' },
        requestId: 'test-req',
      },
      headers: { authorization: 'Bearer eyJhbGciOi.jwt.token' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      isBase64Encoded: false,
    };

    beforeEach(() => {
      mockAuthenticate.mockResolvedValue({
        userId: 'user_456',
        authMethod: 'clerk_oauth',
        deprecated: false,
      });
      mockGetSpotifyTokenFromClerk.mockResolvedValue({
        kind: 'spotify',
        accessToken: 'spot-token',
        refreshToken: 'spot-refresh',
        expiresAt: Date.now() + 60_000,
      });
    });

    it('does not instantiate SpotifyAdapter when ENABLE_SPOTIFY=false', async () => {
      process.env.ENABLE_SPOTIFY = 'false';
      await handler(event as never);
      expect(mockSpotifyAdapter).not.toHaveBeenCalled();
      // Must also not even ask Clerk for the Spotify token
      expect(mockGetSpotifyTokenFromClerk).not.toHaveBeenCalled();
    });

    it('does not instantiate SpotifyAdapter when ENABLE_SPOTIFY is unset', async () => {
      delete process.env.ENABLE_SPOTIFY;
      await handler(event as never);
      expect(mockSpotifyAdapter).not.toHaveBeenCalled();
      expect(mockGetSpotifyTokenFromClerk).not.toHaveBeenCalled();
    });

    it('instantiates SpotifyAdapter when ENABLE_SPOTIFY=true and tokens are available', async () => {
      process.env.ENABLE_SPOTIFY = 'true';
      await handler(event as never);
      expect(mockGetSpotifyTokenFromClerk).toHaveBeenCalledWith('user_456');
      expect(mockSpotifyAdapter).toHaveBeenCalled();
    });
  });
});

describe('handler auth failure responses', () => {
  const mcpEvent = {
    requestContext: {
      http: {
        method: 'POST',
        path: '/mcp',
        sourceIp: '203.0.113.7',
        userAgent: 'test-client/1.0',
      },
      requestId: 'req-auth-test',
    },
    headers: { authorization: 'Bearer some.opaque.token' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when the provider rejected the credential', async () => {
    mockAuthenticate.mockRejectedValue(
      new AuthenticationError('Invalid or expired token', 401),
    );

    const result = await handler(mcpEvent as never);

    expect(result.statusCode).toBe(401);
  });

  it('returns 503 with Retry-After when the provider is unreachable', async () => {
    mockAuthenticate.mockRejectedValue(new UpstreamAuthError(503));

    const result = await handler(mcpEvent as never);

    expect(result.statusCode).toBe(503);
    expect(result.headers?.['Retry-After']).toBe('30');
    expect(JSON.parse(result.body).error).toBe('Auth provider unavailable');
  });

  it('logs request context without token material on auth failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockAuthenticate.mockRejectedValue(new UpstreamAuthError(502));

    await handler(mcpEvent as never);

    const logged = JSON.parse(warn.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      event: 'auth_failure',
      reason: 'Auth provider unavailable',
      upstreamStatus: 502,
      tokenKind: 'jwt',
      sourceIp: '203.0.113.7',
      userAgent: 'test-client/1.0',
    });
    expect(warn.mock.calls[0][0]).not.toContain('some.opaque.token');
    warn.mockRestore();
  });
});
