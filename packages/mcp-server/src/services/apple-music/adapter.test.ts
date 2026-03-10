import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api-client.js', () => ({
  appleMusicFetch: vi.fn(),
  APPLE_MUSIC_API_BASE: 'https://api.music.apple.com/v1',
}));

import { AppleMusicAdapter } from './adapter.js';
import { appleMusicFetch } from './api-client.js';

const mockFetch = vi.mocked(appleMusicFetch);

const DEV_TOKEN = 'dev-token';
const USER_TOKEN = 'user-token';
const tokens = { developerToken: DEV_TOKEN, userToken: USER_TOKEN };

function makeSongResource(
  id: string,
  name: string,
  opts?: { artistName?: string; albumName?: string; durationInMillis?: number; genreNames?: string[] },
) {
  return {
    id,
    type: 'songs',
    attributes: {
      name,
      artistName: opts?.artistName ?? 'Artist',
      albumName: opts?.albumName ?? 'Album',
      durationInMillis: opts?.durationInMillis ?? 200000,
      genreNames: opts?.genreNames ?? ['Pop'],
    },
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('AppleMusicAdapter', () => {
  const adapter = new AppleMusicAdapter(DEV_TOKEN);

  describe('searchCatalog', () => {
    it('passes correct URL with query params', async () => {
      mockFetch.mockResolvedValueOnce({
        results: { songs: { data: [] } },
      });

      await adapter.searchCatalog({ query: 'hello', types: ['songs'], limit: 5, storefront: 'gb' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/catalog/gb/search?'),
        DEV_TOKEN,
      );
      const url = mockFetch.mock.calls[0][0] as string;
      const qs = new URLSearchParams(url.split('?')[1]);
      expect(qs.get('term')).toBe('hello');
      expect(qs.get('types')).toBe('songs');
      expect(qs.get('limit')).toBe('5');
    });

    it('defaults storefront to us, types to songs, limit to 10', async () => {
      mockFetch.mockResolvedValueOnce({
        results: { songs: { data: [] } },
      });

      await adapter.searchCatalog({ query: 'test' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('/catalog/us/search?');
      const qs = new URLSearchParams(url.split('?')[1]);
      expect(qs.get('types')).toBe('songs');
      expect(qs.get('limit')).toBe('10');
    });

    it('transforms song results via toTrack', async () => {
      mockFetch.mockResolvedValueOnce({
        results: {
          songs: {
            data: [
              makeSongResource('s1', 'Song One', {
                artistName: 'Art1',
                albumName: 'Alb1',
                durationInMillis: 180000,
                genreNames: ['Rock', 'Alternative'],
              }),
            ],
          },
        },
      });

      const result = await adapter.searchCatalog({ query: 'test' });

      expect(result.songs).toEqual([
        {
          id: 's1',
          name: 'Song One',
          artistName: 'Art1',
          albumName: 'Alb1',
          durationMs: 180000,
          genre: 'Rock',
        },
      ]);
    });

    it('returns albums and artists when present', async () => {
      mockFetch.mockResolvedValueOnce({
        results: {
          songs: { data: [] },
          albums: {
            data: [
              { id: 'a1', type: 'albums', attributes: { name: 'Album1', artistName: 'Artist1' } },
            ],
          },
          artists: {
            data: [
              { id: 'ar1', type: 'artists', attributes: { name: 'ArtistX' } },
            ],
          },
        },
      });

      const result = await adapter.searchCatalog({ query: 'test' });

      expect(result.albums).toEqual([{ id: 'a1', name: 'Album1', artistName: 'Artist1' }]);
      expect(result.artists).toEqual([{ id: 'ar1', name: 'ArtistX' }]);
    });

    it('handles missing albums/artists in response', async () => {
      mockFetch.mockResolvedValueOnce({
        results: {
          songs: { data: [] },
        },
      });

      const result = await adapter.searchCatalog({ query: 'test' });

      expect(result.songs).toEqual([]);
      expect(result.albums).toBeUndefined();
      expect(result.artists).toBeUndefined();
    });
  });

  describe('listPlaylists', () => {
    it('returns playlist id, name, description', async () => {
      mockFetch.mockResolvedValueOnce({
        data: [
          {
            id: 'p1',
            type: 'library-playlists',
            attributes: {
              name: 'My Playlist',
              description: { standard: 'A cool playlist' },
            },
          },
        ],
      });

      const playlists = await adapter.listPlaylists(tokens);

      expect(playlists).toEqual([
        { id: 'p1', name: 'My Playlist', description: 'A cool playlist' },
      ]);
    });

    it('handles undefined description.standard', async () => {
      mockFetch.mockResolvedValueOnce({
        data: [
          {
            id: 'p2',
            type: 'library-playlists',
            attributes: { name: 'No Desc' },
          },
        ],
      });

      const playlists = await adapter.listPlaylists(tokens);

      expect(playlists).toEqual([
        { id: 'p2', name: 'No Desc', description: undefined },
      ]);
    });
  });

  describe('getPlaylistTracks', () => {
    it('paginates through multiple pages using next field', async () => {
      mockFetch
        .mockResolvedValueOnce({
          data: [makeSongResource('t1', 'Track 1')],
          next: '/me/library/playlists/p1/tracks?offset=100',
        })
        .mockResolvedValueOnce({
          data: [makeSongResource('t2', 'Track 2')],
          next: '/me/library/playlists/p1/tracks?offset=200',
        })
        .mockResolvedValueOnce({
          data: [makeSongResource('t3', 'Track 3')],
          // no next — stop
        });

      const tracks = await adapter.getPlaylistTracks('p1', tokens);

      expect(tracks).toHaveLength(3);
      expect(tracks[0].id).toBe('t1');
      expect(tracks[1].id).toBe('t2');
      expect(tracks[2].id).toBe('t3');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('transforms all tracks via toTrack', async () => {
      mockFetch.mockResolvedValueOnce({
        data: [
          makeSongResource('t1', 'Song', {
            artistName: 'A',
            albumName: 'B',
            durationInMillis: 300000,
            genreNames: ['Jazz'],
          }),
        ],
      });

      const tracks = await adapter.getPlaylistTracks('p1', tokens);

      expect(tracks[0]).toEqual({
        id: 't1',
        name: 'Song',
        artistName: 'A',
        albumName: 'B',
        durationMs: 300000,
        genre: 'Jazz',
      });
    });
  });

  describe('createPlaylist', () => {
    it('sends POST with correct body structure', async () => {
      mockFetch.mockResolvedValueOnce({
        data: [
          {
            id: 'new-p',
            type: 'library-playlists',
            attributes: { name: 'New Playlist' },
          },
        ],
      });

      const result = await adapter.createPlaylist('New Playlist', tokens, 'desc');

      expect(result).toEqual({ id: 'new-p', name: 'New Playlist' });
      expect(mockFetch).toHaveBeenCalledWith(
        '/me/library/playlists',
        DEV_TOKEN,
        USER_TOKEN,
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][3]!.body as string);
      expect(body.attributes).toEqual({ name: 'New Playlist', description: 'desc' });
    });

    it('includes relationships.tracks when trackIds provided', async () => {
      mockFetch.mockResolvedValueOnce({
        data: [
          {
            id: 'new-p',
            type: 'library-playlists',
            attributes: { name: 'PL' },
          },
        ],
      });

      await adapter.createPlaylist('PL', tokens, undefined, ['s1', 's2']);

      const body = JSON.parse(mockFetch.mock.calls[0][3]!.body as string);
      expect(body.relationships).toEqual({
        tracks: {
          data: [
            { id: 's1', type: 'songs' },
            { id: 's2', type: 'songs' },
          ],
        },
      });
    });

    it('omits relationships when no trackIds', async () => {
      mockFetch.mockResolvedValueOnce({
        data: [
          {
            id: 'new-p',
            type: 'library-playlists',
            attributes: { name: 'PL' },
          },
        ],
      });

      await adapter.createPlaylist('PL', tokens);

      const body = JSON.parse(mockFetch.mock.calls[0][3]!.body as string);
      expect(body.relationships).toBeUndefined();
    });
  });

  describe('getRecentlyPlayed', () => {
    it('filters results to only type === songs', async () => {
      mockFetch.mockResolvedValueOnce({
        data: [
          makeSongResource('s1', 'Song 1'),
          { id: 'a1', type: 'albums', attributes: { name: 'Alb', artistName: 'Art', albumName: 'Alb', durationInMillis: 100 } },
          makeSongResource('s2', 'Song 2'),
        ],
      });

      const tracks = await adapter.getRecentlyPlayed(tokens);

      expect(tracks).toHaveLength(2);
      expect(tracks[0].id).toBe('s1');
      expect(tracks[1].id).toBe('s2');
    });
  });

  describe('addToLibrary', () => {
    it('returns early when no songIds or albumIds provided', async () => {
      await adapter.addToLibrary(tokens);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns early when empty arrays provided', async () => {
      await adapter.addToLibrary(tokens, [], []);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sends both songs and albums in single request', async () => {
      mockFetch.mockResolvedValueOnce(null);

      await adapter.addToLibrary(tokens, ['s1', 's2'], ['a1']);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][3]!.body as string);
      expect(body.data).toEqual([
        { id: 's1', type: 'songs' },
        { id: 's2', type: 'songs' },
        { id: 'a1', type: 'albums' },
      ]);
    });
  });
});
