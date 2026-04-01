import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.SHARED_PLAYLISTS_TABLE_NAME = 'test-shared-playlists-table';

vi.mock('node:crypto', () => ({
  default: {
    randomBytes: vi.fn(() => Buffer.from('abcdefghijklmnop')),
  },
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: vi.fn(),
  GetCommand: vi.fn(),
  QueryCommand: vi.fn(),
  UpdateCommand: vi.fn(),
}));

vi.mock('../shared/dynamo.js', () => ({
  ddbDocClient: { send: vi.fn() },
}));

import {
  createSharedPlaylist,
  getSharedPlaylist,
  listSharedPlaylists,
  deleteSharedPlaylist,
} from './shared-playlists.js';
import { ddbDocClient } from '../shared/dynamo.js';

const validInput = {
  title: 'My Playlist',
  service: 'spotify',
  tracks: [{ title: 'Song 1', artist: 'Artist 1' }],
};

describe('createSharedPlaylist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 201 with shareId and shareUrl on success', async () => {
    // First send: QueryCommand for count check
    vi.mocked(ddbDocClient.send)
      .mockResolvedValueOnce({ Count: 0 } as any)
      // Second send: PutCommand
      .mockResolvedValueOnce({} as any);

    const result = await createSharedPlaylist('user-123', validInput);
    expect(result.statusCode).toBe(201);

    const body = JSON.parse(result.body);
    expect(body.shareId).toBeDefined();
    expect(body.shareUrl).toContain('https://mixcraft.app/share/');
    expect(body.createdAt).toBeDefined();
    expect(ddbDocClient.send).toHaveBeenCalledTimes(2);
  });

  it('returns 400 when title is missing', async () => {
    const result = await createSharedPlaylist('user-123', {
      ...validInput,
      title: '',
    });
    expect(result.statusCode).toBe(400);

    const body = JSON.parse(result.body);
    expect(body.error).toContain('Title is required');
  });

  it('returns 400 when title is too long', async () => {
    const result = await createSharedPlaylist('user-123', {
      ...validInput,
      title: 'x'.repeat(201),
    });
    expect(result.statusCode).toBe(400);

    const body = JSON.parse(result.body);
    expect(body.error).toContain('Title is required');
  });

  it('returns 400 when service is invalid', async () => {
    const result = await createSharedPlaylist('user-123', {
      ...validInput,
      service: 'tidal',
    });
    expect(result.statusCode).toBe(400);

    const body = JSON.parse(result.body);
    expect(body.error).toContain('Service must be apple_music or spotify');
  });

  it('returns 400 when tracks array is empty', async () => {
    const result = await createSharedPlaylist('user-123', {
      ...validInput,
      tracks: [],
    });
    expect(result.statusCode).toBe(400);

    const body = JSON.parse(result.body);
    expect(body.error).toContain('Tracks array must have 1-500 items');
  });

  it('returns 400 when conversationSummary is too long', async () => {
    const result = await createSharedPlaylist('user-123', {
      ...validInput,
      conversationSummary: 'x'.repeat(5001),
    });
    expect(result.statusCode).toBe(400);

    const body = JSON.parse(result.body);
    expect(body.error).toContain('Conversation summary must be under 5000 characters');
  });

  it('returns 400 when user has reached 50 shares limit', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({ Count: 50 } as any);

    const result = await createSharedPlaylist('user-123', validInput);
    expect(result.statusCode).toBe(400);

    const body = JSON.parse(result.body);
    expect(body.error).toContain('Maximum 50 shared playlists allowed');
  });
});

describe('getSharedPlaylist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with playlist data without userId', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({
      Item: {
        shareId: 'abc123',
        userId: 'user-123',
        title: 'My Playlist',
        service: 'spotify',
        playlistExternalId: 'ext-1',
        trackCount: 2,
        tracks: [
          { title: 'Song 1', artist: 'Artist 1' },
          { title: 'Song 2', artist: 'Artist 2' },
        ],
        conversationSummary: 'A summary',
        createdAt: '2025-01-01T00:00:00Z',
      },
    } as any);

    const result = await getSharedPlaylist('abc123');
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.shareId).toBe('abc123');
    expect(body.title).toBe('My Playlist');
    expect(body.service).toBe('spotify');
    expect(body.trackCount).toBe(2);
    expect(body.tracks).toHaveLength(2);
    expect(body.conversationSummary).toBe('A summary');
    expect(body.createdAt).toBe('2025-01-01T00:00:00Z');
    // Must not expose userId
    expect(body.userId).toBeUndefined();
  });

  it('returns 404 when item is not found', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({ Item: undefined } as any);

    const result = await getSharedPlaylist('nonexistent');
    expect(result.statusCode).toBe(404);

    const body = JSON.parse(result.body);
    expect(body.error).toBe('Not found');
  });

  it('returns 404 when item is soft-deleted', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({
      Item: {
        shareId: 'abc123',
        userId: 'user-123',
        title: 'Deleted Playlist',
        isDeleted: true,
      },
    } as any);

    const result = await getSharedPlaylist('abc123');
    expect(result.statusCode).toBe(404);

    const body = JSON.parse(result.body);
    expect(body.error).toBe('Not found');
  });
});

describe('listSharedPlaylists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns items newest first', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({
      Items: [
        {
          shareId: 'newer',
          title: 'Newer Playlist',
          service: 'spotify',
          trackCount: 3,
          createdAt: '2025-02-01T00:00:00Z',
        },
        {
          shareId: 'older',
          title: 'Older Playlist',
          service: 'apple_music',
          trackCount: 5,
          createdAt: '2025-01-01T00:00:00Z',
        },
      ],
    } as any);

    const result = await listSharedPlaylists('user-123');
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].shareId).toBe('newer');
    expect(body.items[0].shareUrl).toBe('https://mixcraft.app/share/newer');
    expect(body.items[0].title).toBe('Newer Playlist');
    expect(body.items[1].shareId).toBe('older');
    expect(body.items[1].shareUrl).toBe('https://mixcraft.app/share/older');
  });
});

describe('deleteSharedPlaylist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 on successful delete', async () => {
    vi.mocked(ddbDocClient.send)
      // GetCommand to verify ownership
      .mockResolvedValueOnce({
        Item: {
          shareId: 'abc123',
          userId: 'user-123',
          title: 'My Playlist',
        },
      } as any)
      // UpdateCommand for soft delete
      .mockResolvedValueOnce({} as any);

    const result = await deleteSharedPlaylist('user-123', 'abc123');
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(ddbDocClient.send).toHaveBeenCalledTimes(2);
  });

  it('returns 404 when item is not found', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({ Item: undefined } as any);

    const result = await deleteSharedPlaylist('user-123', 'nonexistent');
    expect(result.statusCode).toBe(404);

    const body = JSON.parse(result.body);
    expect(body.error).toBe('Not found');
  });

  it('returns 403 when user does not own the playlist', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({
      Item: {
        shareId: 'abc123',
        userId: 'other-user',
        title: 'Not Mine',
      },
    } as any);

    const result = await deleteSharedPlaylist('user-123', 'abc123');
    expect(result.statusCode).toBe(403);

    const body = JSON.parse(result.body);
    expect(body.error).toBe('Forbidden');
  });
});
