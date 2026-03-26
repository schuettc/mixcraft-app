import { spotifyFetch } from './api-client.js';
import { SpotifyTokenExpiredError } from '../../shared/errors.js';
import type {
  MusicServiceAdapter,
  MusicServiceCapability,
  SearchParams,
  SearchResult,
  Track,
  Playlist,
  CreatePlaylistResult,
  UpdatePlaylistParams,
  ServiceTokens,
  SpotifyTokens,
} from '../types.js';

export type TokenRefreshFn = () => Promise<string | null>;

// ---------- Spotify response shapes ----------

interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string };
  duration_ms: number;
}

interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  tracks: { total: number };
}

interface SpotifySearchResponse {
  tracks?: { items: SpotifyTrack[] };
  albums?: { items: Array<{ id: string; name: string; artists: Array<{ name: string }> }> };
  artists?: { items: Array<{ id: string; name: string }> };
}

interface SpotifyPlaylistsResponse {
  items: SpotifyPlaylist[];
}

interface SpotifyPlaylistTracksResponse {
  items: Array<{ track: SpotifyTrack | null }>;
  next: string | null;
}

interface SpotifyRecentlyPlayedResponse {
  items: Array<{ track: SpotifyTrack }>;
}

interface SpotifyLibraryTracksResponse {
  items: Array<{ track: SpotifyTrack }>;
}

interface SpotifyUserProfile {
  id: string;
}

interface SpotifyTopItemsResponse {
  items: Array<{ id: string; name: string }>;
}

// ---------- Helpers ----------

function assertSpotifyTokens(tokens: ServiceTokens): SpotifyTokens {
  if (tokens.kind !== 'spotify') {
    throw new Error('SpotifyAdapter requires spotify tokens');
  }
  return tokens;
}

/** Spotify resource IDs are alphanumeric (no dots or hyphens). */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9]+$/;

function validateResourceId(id: string, label: string): void {
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${label}: must be alphanumeric`);
  }
}

function toTrack(t: SpotifyTrack): Track {
  return {
    id: t.id,
    name: t.name,
    artistName: t.artists[0]?.name ?? 'Unknown',
    albumName: t.album.name,
    durationMs: t.duration_ms,
  };
}

// ---------- Adapter ----------

export class SpotifyAdapter implements MusicServiceAdapter {
  readonly serviceName = 'spotify';
  readonly supportedCapabilities: readonly MusicServiceCapability[] = [
    'remove_playlist',
    'remove_tracks_from_playlist',
    'reorder_playlist_tracks',
    'update_playlist',
    'remove_from_library',
    'get_top_items',
  ];

  private onTokenRefresh?: TokenRefreshFn;

  constructor(private accessToken: string, onTokenRefresh?: TokenRefreshFn) {
    this.onTokenRefresh = onTokenRefresh;
  }

  /**
   * Wrapper around spotifyFetch that handles 401 by refreshing the token
   * and retrying once. All adapter methods should use this instead of
   * calling spotifyFetch directly.
   */
  private async fetch(
    endpoint: string,
    accessToken: string,
    options: RequestInit = {},
  ): Promise<unknown> {
    try {
      return await spotifyFetch(endpoint, accessToken, options);
    } catch (err) {
      if (err instanceof SpotifyTokenExpiredError && this.onTokenRefresh) {
        const newToken = await this.onTokenRefresh();
        if (newToken) {
          this.accessToken = newToken;
          return await spotifyFetch(endpoint, newToken, options);
        }
      }
      throw err;
    }
  }

  async searchCatalog(params: SearchParams): Promise<SearchResult> {
    const market = params.storefront ?? 'us';
    const types = (params.types ?? ['songs']).map((t) => {
      if (t === 'songs') return 'track';
      if (t === 'albums') return 'album';
      if (t === 'artists') return 'artist';
      return t;
    });
    const limit = params.limit ?? 10;

    const qs = new URLSearchParams({
      q: params.query,
      type: types.join(','),
      market: market.toUpperCase(),
      limit: String(limit),
    });

    const raw = (await this.fetch(
      `/search?${qs.toString()}`,
      this.accessToken,
    )) as SpotifySearchResponse;

    const songs = (raw.tracks?.items ?? []).map(toTrack);

    const albums = raw.albums?.items.map((a) => ({
      id: a.id,
      name: a.name,
      artistName: a.artists[0]?.name ?? 'Unknown',
    }));

    const artists = raw.artists?.items.map((a) => ({
      id: a.id,
      name: a.name,
    }));

    return { songs, albums, artists };
  }

  async listPlaylists(
    tokens: ServiceTokens,
    limit = 25,
    offset = 0,
  ): Promise<Playlist[]> {
    const t = assertSpotifyTokens(tokens);
    const cappedLimit = Math.min(limit, 50);
    const qs = new URLSearchParams({
      limit: String(cappedLimit),
      offset: String(offset),
    });

    const raw = (await this.fetch(
      `/me/playlists?${qs.toString()}`,
      t.accessToken,
    )) as SpotifyPlaylistsResponse;

    return raw.items.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? undefined,
      trackCount: p.tracks?.total,
    }));
  }

  async getPlaylistTracks(
    playlistId: string,
    tokens: ServiceTokens,
  ): Promise<Track[]> {
    const t = assertSpotifyTokens(tokens);
    validateResourceId(playlistId, 'playlistId');
    const tracks: Track[] = [];
    let endpoint: string | null =
      `/playlists/${playlistId}/tracks?limit=50&offset=0`;

    while (endpoint) {
      const raw = (await this.fetch(
        endpoint,
        t.accessToken,
      )) as SpotifyPlaylistTracksResponse;

      for (const item of raw.items) {
        if (item.track) {
          tracks.push(toTrack(item.track));
        }
      }

      endpoint = raw.next;
    }

    return tracks;
  }

  async createPlaylist(
    name: string,
    tokens: ServiceTokens,
    description?: string,
    trackIds?: string[],
  ): Promise<CreatePlaylistResult> {
    const t = assertSpotifyTokens(tokens);
    if (trackIds) {
      trackIds.forEach((id) => validateResourceId(id, 'trackId'));
    }

    // Step 1: Get current user's Spotify ID
    const profile = (await this.fetch(
      '/me',
      t.accessToken,
    )) as SpotifyUserProfile;

    // Step 2: Create the playlist
    const body = {
      name,
      ...(description ? { description } : {}),
      public: false,
    };

    const created = (await this.fetch(
      `/users/${profile.id}/playlists`,
      t.accessToken,
      { method: 'POST', body: JSON.stringify(body) },
    )) as { id: string; name: string };

    // Step 3: Add tracks if provided
    if (trackIds && trackIds.length > 0) {
      await this.fetch(
        `/playlists/${created.id}/tracks`,
        t.accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            uris: trackIds.map((id) => `spotify:track:${id}`),
          }),
        },
      );
    }

    return { id: created.id, name: created.name };
  }

  async addTracks(
    playlistId: string,
    trackIds: string[],
    tokens: ServiceTokens,
  ): Promise<void> {
    const t = assertSpotifyTokens(tokens);
    validateResourceId(playlistId, 'playlistId');
    trackIds.forEach((id) => validateResourceId(id, 'trackId'));

    await this.fetch(
      `/playlists/${playlistId}/tracks`,
      t.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          uris: trackIds.map((id) => `spotify:track:${id}`),
        }),
      },
    );
  }

  async getRecentlyPlayed(
    tokens: ServiceTokens,
    limit = 10,
  ): Promise<Track[]> {
    const t = assertSpotifyTokens(tokens);
    const cappedLimit = Math.min(limit, 50);
    const qs = new URLSearchParams({ limit: String(cappedLimit) });

    const raw = (await this.fetch(
      `/me/player/recently-played?${qs.toString()}`,
      t.accessToken,
    )) as SpotifyRecentlyPlayedResponse;

    return raw.items.map((item) => toTrack(item.track));
  }

  async getLibrarySongs(
    tokens: ServiceTokens,
    limit = 25,
    offset = 0,
  ): Promise<Track[]> {
    const t = assertSpotifyTokens(tokens);
    const cappedLimit = Math.min(limit, 50);
    const qs = new URLSearchParams({
      limit: String(cappedLimit),
      offset: String(offset),
    });

    const raw = (await this.fetch(
      `/me/tracks?${qs.toString()}`,
      t.accessToken,
    )) as SpotifyLibraryTracksResponse;

    return raw.items.map((item) => toTrack(item.track));
  }

  async addToLibrary(
    tokens: ServiceTokens,
    songIds?: string[],
    albumIds?: string[],
  ): Promise<void> {
    const t = assertSpotifyTokens(tokens);

    if (songIds && songIds.length > 0) {
      songIds.forEach((id) => validateResourceId(id, 'songId'));
      // Spotify allows max 50 IDs per request for tracks
      for (let i = 0; i < songIds.length; i += 50) {
        const batch = songIds.slice(i, i + 50);
        await this.fetch(
          '/me/tracks',
          t.accessToken,
          { method: 'PUT', body: JSON.stringify({ ids: batch }) },
        );
      }
    }

    if (albumIds && albumIds.length > 0) {
      albumIds.forEach((id) => validateResourceId(id, 'albumId'));
      // Spotify allows max 20 IDs per request for albums
      for (let i = 0; i < albumIds.length; i += 20) {
        const batch = albumIds.slice(i, i + 20);
        await this.fetch(
          '/me/albums',
          t.accessToken,
          { method: 'PUT', body: JSON.stringify({ ids: batch }) },
        );
      }
    }
  }

  // ---------- Spotify-only operations ----------

  async removePlaylist(
    playlistId: string,
    tokens: ServiceTokens,
  ): Promise<void> {
    const t = assertSpotifyTokens(tokens);
    validateResourceId(playlistId, 'playlistId');

    await this.fetch(
      `/playlists/${playlistId}/followers`,
      t.accessToken,
      { method: 'DELETE' },
    );
  }

  async removeTracksFromPlaylist(
    playlistId: string,
    trackUris: string[],
    tokens: ServiceTokens,
  ): Promise<void> {
    const t = assertSpotifyTokens(tokens);
    validateResourceId(playlistId, 'playlistId');

    await this.fetch(
      `/playlists/${playlistId}/tracks`,
      t.accessToken,
      {
        method: 'DELETE',
        body: JSON.stringify({
          tracks: trackUris.map((uri) => ({
            uri: uri.startsWith('spotify:') ? uri : `spotify:track:${uri}`,
          })),
        }),
      },
    );
  }

  async reorderPlaylistTracks(
    playlistId: string,
    rangeStart: number,
    insertBefore: number,
    tokens: ServiceTokens,
    rangeLength?: number,
  ): Promise<void> {
    const t = assertSpotifyTokens(tokens);
    validateResourceId(playlistId, 'playlistId');

    await this.fetch(
      `/playlists/${playlistId}/tracks`,
      t.accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({
          range_start: rangeStart,
          insert_before: insertBefore,
          range_length: rangeLength ?? 1,
        }),
      },
    );
  }

  async updatePlaylist(
    playlistId: string,
    params: UpdatePlaylistParams,
    tokens: ServiceTokens,
  ): Promise<void> {
    const t = assertSpotifyTokens(tokens);
    validateResourceId(playlistId, 'playlistId');

    const body: Record<string, unknown> = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.description !== undefined) body.description = params.description;
    if (params.isPublic !== undefined) body.public = params.isPublic;

    await this.fetch(
      `/playlists/${playlistId}`,
      t.accessToken,
      { method: 'PUT', body: JSON.stringify(body) },
    );
  }

  async removeFromLibrary(
    tokens: ServiceTokens,
    songIds?: string[],
    albumIds?: string[],
  ): Promise<void> {
    const t = assertSpotifyTokens(tokens);

    if (songIds && songIds.length > 0) {
      songIds.forEach((id) => validateResourceId(id, 'songId'));
      await this.fetch(
        '/me/tracks',
        t.accessToken,
        { method: 'DELETE', body: JSON.stringify({ ids: songIds }) },
      );
    }

    if (albumIds && albumIds.length > 0) {
      albumIds.forEach((id) => validateResourceId(id, 'albumId'));
      await this.fetch(
        '/me/albums',
        t.accessToken,
        { method: 'DELETE', body: JSON.stringify({ ids: albumIds }) },
      );
    }
  }

  async getTopItems(
    tokens: ServiceTokens,
    type: 'artists' | 'tracks',
    timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term',
    limit = 20,
  ): Promise<Array<{ id: string; name: string }>> {
    const t = assertSpotifyTokens(tokens);
    const qs = new URLSearchParams({
      time_range: timeRange,
      limit: String(limit),
    });

    const raw = (await this.fetch(
      `/me/top/${type}?${qs.toString()}`,
      t.accessToken,
    )) as SpotifyTopItemsResponse;

    return raw.items.map((item) => ({
      id: item.id,
      name: item.name,
    }));
  }
}
