import { appleMusicFetch } from './api-client.js';
import type {
  MusicServiceAdapter,
  MusicServiceCapability,
  ServiceTokens,
  SearchParams,
  SearchResult,
  Track,
  Playlist,
  CreatePlaylistResult,
} from '../types.js';
import type { AppleMusicTokens } from '../../shared/token-manager.js';

// ---------- Apple Music response shapes ----------

interface AppleMusicSongAttributes {
  name: string;
  artistName: string;
  albumName: string;
  durationInMillis: number;
  genreNames?: string[];
}

interface AppleMusicResource<A> {
  id: string;
  type: string;
  attributes: A;
}

interface AppleMusicAlbumAttributes {
  name: string;
  artistName: string;
}

interface AppleMusicArtistAttributes {
  name: string;
}

interface AppleMusicSearchResponse {
  results: {
    songs?: { data: AppleMusicResource<AppleMusicSongAttributes>[] };
    albums?: { data: AppleMusicResource<AppleMusicAlbumAttributes>[] };
    artists?: { data: AppleMusicResource<AppleMusicArtistAttributes>[] };
  };
}

interface AppleMusicPlaylistAttributes {
  name: string;
  description?: { standard?: string };
}

interface AppleMusicPlaylistResponse {
  data: AppleMusicResource<AppleMusicPlaylistAttributes>[];
}

interface AppleMusicTracksResponse {
  data: AppleMusicResource<AppleMusicSongAttributes>[];
  next?: string;
}

interface AppleMusicRecentResponse {
  data: AppleMusicResource<AppleMusicSongAttributes>[];
}

interface AppleMusicLibrarySongsResponse {
  data: AppleMusicResource<AppleMusicSongAttributes>[];
}

// ---------- Helpers ----------

function assertAppleMusicTokens(tokens: ServiceTokens): AppleMusicTokens {
  if (tokens.kind !== 'apple_music') {
    throw new Error('AppleMusicAdapter requires apple_music tokens');
  }
  return tokens;
}

/** Apple Music resource IDs are alphanumeric, with dots and hyphens (e.g. "p.AbCdEfGh", "l.12345"). */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

function validateResourceId(id: string, label: string): void {
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${label}: must be alphanumeric`);
  }
}

function toTrack(r: AppleMusicResource<AppleMusicSongAttributes>): Track {
  return {
    id: r.id,
    name: r.attributes.name,
    artistName: r.attributes.artistName,
    albumName: r.attributes.albumName,
    durationMs: r.attributes.durationInMillis,
    genre: r.attributes.genreNames?.[0],
  };
}

// ---------- Adapter ----------

export class AppleMusicAdapter implements MusicServiceAdapter {
  readonly serviceName = 'apple_music';
  readonly supportedCapabilities: readonly MusicServiceCapability[] = [];

  constructor(private developerToken: string) {}

  async searchCatalog(params: SearchParams): Promise<SearchResult> {
    const storefront = params.storefront ?? 'us';
    const types = params.types ?? ['songs'];
    const limit = params.limit ?? 10;

    const qs = new URLSearchParams({
      term: params.query,
      types: types.join(','),
      limit: String(limit),
    });

    const raw = (await appleMusicFetch(
      `/catalog/${storefront}/search?${qs.toString()}`,
      this.developerToken,
    )) as AppleMusicSearchResponse;

    const results = raw.results;

    const songs = (results.songs?.data ?? []).map(toTrack);

    const albums = results.albums?.data.map((a) => ({
      id: a.id,
      name: a.attributes.name,
      artistName: a.attributes.artistName,
    }));

    const artists = results.artists?.data.map((a) => ({
      id: a.id,
      name: a.attributes.name,
    }));

    return { songs, albums, artists };
  }

  async listPlaylists(
    tokens: ServiceTokens,
    limit = 25,
    offset = 0,
  ): Promise<Playlist[]> {
    const t = assertAppleMusicTokens(tokens);
    const qs = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });

    const raw = (await appleMusicFetch(
      `/me/library/playlists?${qs.toString()}`,
      t.developerToken,
      t.userToken,
    )) as AppleMusicPlaylistResponse;

    return raw.data.map((p) => ({
      id: p.id,
      name: p.attributes.name,
      description: p.attributes.description?.standard,
    }));
  }

  async getPlaylistTracks(
    playlistId: string,
    tokens: ServiceTokens,
  ): Promise<Track[]> {
    const t = assertAppleMusicTokens(tokens);
    validateResourceId(playlistId, 'playlistId');
    const tracks: Track[] = [];
    let endpoint: string | null =
      `/me/library/playlists/${playlistId}/tracks?limit=100`;

    while (endpoint) {
      const raw = (await appleMusicFetch(
        endpoint,
        t.developerToken,
        t.userToken,
      )) as AppleMusicTracksResponse;

      tracks.push(...raw.data.map(toTrack));
      endpoint = raw.next ?? null;
    }

    return tracks;
  }

  async createPlaylist(
    name: string,
    tokens: ServiceTokens,
    description?: string,
    trackIds?: string[],
  ): Promise<CreatePlaylistResult> {
    const t = assertAppleMusicTokens(tokens);
    if (trackIds) {
      trackIds.forEach((id) => validateResourceId(id, 'trackId'));
    }

    interface CreateBody {
      attributes: { name: string; description?: string };
      relationships?: {
        tracks: { data: Array<{ id: string; type: string }> };
      };
    }

    const body: CreateBody = {
      attributes: { name, ...(description ? { description } : {}) },
    };

    if (trackIds && trackIds.length > 0) {
      body.relationships = {
        tracks: {
          data: trackIds.map((id) => ({ id, type: 'songs' })),
        },
      };
    }

    const raw = (await appleMusicFetch(
      '/me/library/playlists',
      t.developerToken,
      t.userToken,
      { method: 'POST', body: JSON.stringify(body) },
    )) as { data: [AppleMusicResource<AppleMusicPlaylistAttributes>] };

    return {
      id: raw.data[0].id,
      name: raw.data[0].attributes.name,
    };
  }

  async addTracks(
    playlistId: string,
    trackIds: string[],
    tokens: ServiceTokens,
  ): Promise<void> {
    const t = assertAppleMusicTokens(tokens);
    validateResourceId(playlistId, 'playlistId');
    trackIds.forEach((id) => validateResourceId(id, 'trackId'));
    const body = {
      data: trackIds.map((id) => ({ id, type: 'songs' })),
    };

    await appleMusicFetch(
      `/me/library/playlists/${playlistId}/tracks`,
      t.developerToken,
      t.userToken,
      { method: 'POST', body: JSON.stringify(body) },
    );
  }

  async getRecentlyPlayed(tokens: ServiceTokens, limit = 10): Promise<Track[]> {
    const t = assertAppleMusicTokens(tokens);
    const qs = new URLSearchParams({ limit: String(limit) });

    const raw = (await appleMusicFetch(
      `/me/recent/played/tracks?${qs.toString()}`,
      t.developerToken,
      t.userToken,
    )) as AppleMusicRecentResponse;

    return raw.data
      .filter((r) => r.type === 'songs')
      .map(toTrack);
  }

  async getLibrarySongs(
    tokens: ServiceTokens,
    limit = 25,
    offset = 0,
  ): Promise<Track[]> {
    const t = assertAppleMusicTokens(tokens);
    const qs = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });

    const raw = (await appleMusicFetch(
      `/me/library/songs?${qs.toString()}`,
      t.developerToken,
      t.userToken,
    )) as AppleMusicLibrarySongsResponse;

    return raw.data.map(toTrack);
  }

  async addToLibrary(
    tokens: ServiceTokens,
    songIds?: string[],
    albumIds?: string[],
  ): Promise<void> {
    const t = assertAppleMusicTokens(tokens);
    const data: Array<{ id: string; type: string }> = [];

    if (songIds) {
      songIds.forEach((id) => validateResourceId(id, 'songId'));
      data.push(...songIds.map((id) => ({ id, type: 'songs' })));
    }
    if (albumIds) {
      albumIds.forEach((id) => validateResourceId(id, 'albumId'));
      data.push(...albumIds.map((id) => ({ id, type: 'albums' })));
    }

    if (data.length === 0) {
      return;
    }

    await appleMusicFetch(
      '/me/library',
      t.developerToken,
      t.userToken,
      { method: 'POST', body: JSON.stringify({ data }) },
    );
  }
}
