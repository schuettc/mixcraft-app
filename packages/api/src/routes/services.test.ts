import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.USER_MUSIC_TOKENS_TABLE_NAME = 'test-tokens-table';
process.env.ENABLE_SPOTIFY = 'true';

vi.mock('../shared/dynamo.js', () => ({
  ddbDocClient: { send: vi.fn() },
}));

vi.mock('../shared/kms.js', () => ({
  encryptToken: vi.fn().mockResolvedValue('encrypted-token-data'),
}));

import {
  connectService,
  disconnectService,
  getServiceStatus,
  getAllServicesStatus,
  normalizeProvider,
} from './services.js';
import { ddbDocClient } from '../shared/dynamo.js';

describe('normalizeProvider', () => {
  it('converts hyphens to underscores', () => {
    expect(normalizeProvider('apple-music')).toBe('apple_music');
  });

  it('leaves underscored names unchanged', () => {
    expect(normalizeProvider('apple_music')).toBe('apple_music');
  });

  it('handles simple names', () => {
    expect(normalizeProvider('spotify')).toBe('spotify');
  });
});

describe('connectService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for unsupported provider', async () => {
    const result = await connectService('user-123', 'pandora', 'token');
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('Unsupported provider');
  });

  it('stores encrypted token for spotify', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({} as any);

    const result = await connectService('user-123', 'spotify', 'my-token');
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);

    const putCommand = vi.mocked(ddbDocClient.send).mock.calls[0][0] as any;
    expect(putCommand.input.Item.userId).toBe('user-123');
    expect(putCommand.input.Item.service).toBe('spotify');
    expect(putCommand.input.Item.encryptedToken).toBe('encrypted-token-data');
  });

  it('stores encrypted token for apple_music', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({} as any);

    const result = await connectService('user-123', 'apple_music', 'my-token');
    expect(result.statusCode).toBe(200);

    const putCommand = vi.mocked(ddbDocClient.send).mock.calls[0][0] as any;
    expect(putCommand.input.Item.service).toBe('apple_music');
  });

  it('accepts hyphenated provider name', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({} as any);

    const result = await connectService('user-123', 'apple-music', 'my-token');
    expect(result.statusCode).toBe(200);

    const putCommand = vi.mocked(ddbDocClient.send).mock.calls[0][0] as any;
    expect(putCommand.input.Item.service).toBe('apple_music');
  });
});

describe('disconnectService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for unsupported provider', async () => {
    const result = await disconnectService('user-123', 'pandora');
    expect(result.statusCode).toBe(400);
  });

  it('deletes record for valid provider', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({} as any);

    const result = await disconnectService('user-123', 'spotify');
    expect(result.statusCode).toBe(200);

    const deleteCommand = vi.mocked(ddbDocClient.send).mock.calls[0][0] as any;
    expect(deleteCommand.input.Key).toEqual({ userId: 'user-123', service: 'spotify' });
  });
});

describe('getServiceStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for unsupported provider', async () => {
    const result = await getServiceStatus('user-123', 'pandora');
    expect(result.statusCode).toBe(400);
  });

  it('returns connected: true when token exists', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({
      Item: { connectedAt: '2024-01-01T00:00:00Z' },
    } as any);

    const result = await getServiceStatus('user-123', 'spotify');
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.connected).toBe(true);
    expect(body.connectedAt).toBe('2024-01-01T00:00:00Z');
  });

  it('returns connected: false when no token', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({ Item: undefined } as any);

    const result = await getServiceStatus('user-123', 'spotify');
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.connected).toBe(false);
  });
});

describe('getAllServicesStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all providers with default disconnected state', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({ Items: undefined } as any);

    const result = await getAllServicesStatus('user-123');
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.services.apple_music.connected).toBe(false);
    expect(body.services.spotify.connected).toBe(false);
  });

  it('marks connected services correctly', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({
      Items: [
        { service: 'spotify', connectedAt: '2024-01-01T00:00:00Z' },
      ],
    } as any);

    const result = await getAllServicesStatus('user-123');
    const body = JSON.parse(result.body);

    expect(body.services.spotify.connected).toBe(true);
    expect(body.services.spotify.connectedAt).toBe('2024-01-01T00:00:00Z');
    expect(body.services.apple_music.connected).toBe(false);
  });

  it('handles both services connected', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({
      Items: [
        { service: 'apple_music', connectedAt: '2024-01-01T00:00:00Z' },
        { service: 'spotify', connectedAt: '2024-01-02T00:00:00Z' },
      ],
    } as any);

    const result = await getAllServicesStatus('user-123');
    const body = JSON.parse(result.body);

    expect(body.services.apple_music.connected).toBe(true);
    expect(body.services.spotify.connected).toBe(true);
  });
});

describe('ENABLE_SPOTIFY flag off', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_SPOTIFY = 'false';
  });

  afterEach(() => {
    process.env.ENABLE_SPOTIFY = 'true';
  });

  it('connectService rejects spotify with 400', async () => {
    const result = await connectService('user-123', 'spotify', 'token');
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('not enabled');
    // Must not have written to dynamo
    expect(ddbDocClient.send).not.toHaveBeenCalled();
  });

  it('connectService still accepts apple_music', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({} as any);
    const result = await connectService('user-123', 'apple_music', 'token');
    expect(result.statusCode).toBe(200);
  });

  it('disconnectService rejects spotify with 400', async () => {
    const result = await disconnectService('user-123', 'spotify');
    expect(result.statusCode).toBe(400);
    expect(ddbDocClient.send).not.toHaveBeenCalled();
  });

  it('getServiceStatus returns connected:false for spotify without hitting dynamo', async () => {
    const result = await getServiceStatus('user-123', 'spotify');
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.connected).toBe(false);
    expect(ddbDocClient.send).not.toHaveBeenCalled();
  });

  it('getAllServicesStatus reports spotify as connected:false even with stale record', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({
      // Stale spotify record from before flag was disabled — must not surface
      // as connected, but the key must still exist so frontend code that
      // reads services.spotify.connected doesn't crash.
      Items: [
        { service: 'apple_music', connectedAt: '2024-01-01T00:00:00Z' },
        { service: 'spotify', connectedAt: '2024-01-02T00:00:00Z' },
      ],
    } as any);

    const result = await getAllServicesStatus('user-123');
    const body = JSON.parse(result.body);

    expect(body.services.apple_music.connected).toBe(true);
    expect(body.services.spotify).toBeDefined();
    expect(body.services.spotify.connected).toBe(false);
    expect(body.services.spotify.connectedAt).toBe('');
  });
});
