import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

vi.mock('./shared/clerk.js', () => ({
  validateClerkSession: vi.fn(),
}));
vi.mock('./routes/auth.js', () => ({
  handleWebhook: vi.fn(),
}));
vi.mock('./routes/api-keys.js', () => ({
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  deactivateApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
}));
vi.mock('./routes/apple-music.js', () => ({
  connectAppleMusic: vi.fn(),
  disconnectAppleMusic: vi.fn(),
  getAppleMusicStatus: vi.fn(),
}));
vi.mock('./routes/developer-token.js', () => ({
  getDeveloperToken: vi.fn(),
}));

import { handler } from './index.js';
import { validateClerkSession } from './shared/clerk.js';
import { handleWebhook } from './routes/auth.js';
import { listApiKeys, createApiKey, deleteApiKey } from './routes/api-keys.js';
import { connectAppleMusic, getAppleMusicStatus } from './routes/apple-music.js';

function makeEvent(
  method: string,
  path: string,
  overrides?: Partial<APIGatewayProxyEventV2>,
): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: { method, path },
      requestId: 'test-id',
      accountId: '',
      apiId: '',
      stage: '',
    } as any,
    rawPath: path,
    headers: { authorization: 'Bearer test-token' },
    isBase64Encoded: false,
    version: '2.0',
    routeKey: '',
    rawQueryString: '',
    ...overrides,
  } as APIGatewayProxyEventV2;
}

describe('handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 204 with CORS headers for OPTIONS', async () => {
    const event = makeEvent('OPTIONS', '/api/keys');
    const result = await handler(event) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(204);
    expect(result.headers!['Access-Control-Allow-Origin']).toBeDefined();
    expect(result.headers!['Access-Control-Allow-Methods']).toContain('OPTIONS');
  });

  it('routes POST /api/auth/webhook to handleWebhook without auth', async () => {
    vi.mocked(handleWebhook).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    });

    const event = makeEvent('POST', '/api/auth/webhook');
    const result = await handler(event) as APIGatewayProxyStructuredResultV2;

    expect(handleWebhook).toHaveBeenCalledWith(event);
    expect(validateClerkSession).not.toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
  });

  it('routes GET /api/keys to listApiKeys with userId', async () => {
    vi.mocked(validateClerkSession).mockResolvedValue({ userId: 'user-123' });
    vi.mocked(listApiKeys).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify([]),
    });

    const event = makeEvent('GET', '/api/keys');
    const result = await handler(event) as APIGatewayProxyStructuredResultV2;

    expect(validateClerkSession).toHaveBeenCalledWith('Bearer test-token');
    expect(listApiKeys).toHaveBeenCalledWith('user-123');
    expect(result.statusCode).toBe(200);
  });

  it('routes POST /api/keys to createApiKey with parsed body', async () => {
    vi.mocked(validateClerkSession).mockResolvedValue({ userId: 'user-123' });
    vi.mocked(createApiKey).mockResolvedValue({
      statusCode: 201,
      body: JSON.stringify({ rawKey: 'mx_abc' }),
    });

    const event = makeEvent('POST', '/api/keys', {
      body: JSON.stringify({ name: 'My Key' }),
    });
    const result = await handler(event) as APIGatewayProxyStructuredResultV2;

    expect(createApiKey).toHaveBeenCalledWith('user-123', 'My Key');
    expect(result.statusCode).toBe(201);
  });

  it('routes DELETE /api/keys/{hash} to deleteApiKey with decoded keyHash', async () => {
    vi.mocked(validateClerkSession).mockResolvedValue({ userId: 'user-123' });
    vi.mocked(deleteApiKey).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    });

    const event = makeEvent('DELETE', '/api/keys/abc%20def');
    const result = await handler(event) as APIGatewayProxyStructuredResultV2;

    expect(deleteApiKey).toHaveBeenCalledWith('user-123', 'abc def');
    expect(result.statusCode).toBe(200);
  });

  it('returns 400 for DELETE /api/keys/ without hash', async () => {
    vi.mocked(validateClerkSession).mockResolvedValue({ userId: 'user-123' });

    const event = makeEvent('DELETE', '/api/keys/');
    const result = await handler(event) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error).toBe('Missing keyHash');
  });

  it('routes POST /api/apple-music/connect to connectAppleMusic', async () => {
    vi.mocked(validateClerkSession).mockResolvedValue({ userId: 'user-123' });
    vi.mocked(connectAppleMusic).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    });

    const event = makeEvent('POST', '/api/apple-music/connect', {
      body: JSON.stringify({ musicUserToken: 'token-abc' }),
    });
    const result = await handler(event) as APIGatewayProxyStructuredResultV2;

    expect(connectAppleMusic).toHaveBeenCalledWith('user-123', 'token-abc');
    expect(result.statusCode).toBe(200);
  });

  it('returns 400 for POST /api/apple-music/connect without musicUserToken', async () => {
    vi.mocked(validateClerkSession).mockResolvedValue({ userId: 'user-123' });

    const event = makeEvent('POST', '/api/apple-music/connect', {
      body: JSON.stringify({}),
    });
    const result = await handler(event) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error).toBe('Missing musicUserToken');
  });

  it('routes GET /api/apple-music/status to getAppleMusicStatus', async () => {
    vi.mocked(validateClerkSession).mockResolvedValue({ userId: 'user-123' });
    vi.mocked(getAppleMusicStatus).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ connected: true }),
    });

    const event = makeEvent('GET', '/api/apple-music/status');
    const result = await handler(event) as APIGatewayProxyStructuredResultV2;

    expect(getAppleMusicStatus).toHaveBeenCalledWith('user-123');
    expect(result.statusCode).toBe(200);
  });

  it('returns 404 for unknown routes', async () => {
    vi.mocked(validateClerkSession).mockResolvedValue({ userId: 'user-123' });

    const event = makeEvent('GET', '/api/unknown');
    const result = await handler(event) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.error).toBe('Not found');
  });

  it('returns 401 for auth errors', async () => {
    vi.mocked(validateClerkSession).mockRejectedValue(
      new Error('Missing or invalid Authorization header'),
    );

    const event = makeEvent('GET', '/api/keys');
    const result = await handler(event) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body as string);
    expect(body.error).toBe('Missing or invalid Authorization header');
  });

  it('returns 500 for other errors', async () => {
    vi.mocked(validateClerkSession).mockRejectedValue(
      new Error('Something broke'),
    );

    const event = makeEvent('GET', '/api/keys');
    const result = await handler(event) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error).toBe('Something broke');
  });
});
