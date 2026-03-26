export { type ServiceTokens, type AppleMusicTokens, type SpotifyTokens } from '../shared/token-manager.js';
import type { ServiceTokens } from '../shared/token-manager.js';

export interface SearchParams {
  query: string;
  types?: string[]; // e.g. ['songs', 'albums', 'artists']
  storefront?: string; // default: 'us'
  limit?: number; // 1-25
}

export interface Track {
  id: string;
  name: string;
  artistName: string;
  albumName: string;
  durationMs: number;
  genre?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  trackCount?: number;
}

export interface SearchResult {
  songs: Track[];
  albums?: Array<{ id: string; name: string; artistName: string }>;
  artists?: Array<{ id: string; name: string }>;
}

export interface CreatePlaylistResult {
  id: string;
  name: string;
}

export type MusicServiceCapability =
  | 'remove_playlist'
  | 'remove_tracks_from_playlist'
  | 'reorder_playlist_tracks'
  | 'update_playlist'
  | 'remove_from_library'
  | 'get_top_items';

export interface UpdatePlaylistParams {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

export interface MusicServiceAdapter {
  readonly serviceName: string;
  readonly supportedCapabilities: readonly MusicServiceCapability[];
  searchCatalog(params: SearchParams): Promise<SearchResult>;
  listPlaylists(
    tokens: ServiceTokens,
    limit?: number,
    offset?: number,
  ): Promise<Playlist[]>;
  getPlaylistTracks(
    playlistId: string,
    tokens: ServiceTokens,
  ): Promise<Track[]>;
  createPlaylist(
    name: string,
    tokens: ServiceTokens,
    description?: string,
    trackIds?: string[],
  ): Promise<CreatePlaylistResult>;
  addTracks(
    playlistId: string,
    trackIds: string[],
    tokens: ServiceTokens,
  ): Promise<void>;
  getRecentlyPlayed(
    tokens: ServiceTokens,
    limit?: number,
  ): Promise<Track[]>;
  getLibrarySongs(
    tokens: ServiceTokens,
    limit?: number,
    offset?: number,
  ): Promise<Track[]>;
  addToLibrary(
    tokens: ServiceTokens,
    songIds?: string[],
    albumIds?: string[],
  ): Promise<void>;

  // Optional capabilities (Spotify-only)
  removePlaylist?(playlistId: string, tokens: ServiceTokens): Promise<void>;
  removeTracksFromPlaylist?(
    playlistId: string,
    trackUris: string[],
    tokens: ServiceTokens,
  ): Promise<void>;
  reorderPlaylistTracks?(
    playlistId: string,
    rangeStart: number,
    insertBefore: number,
    tokens: ServiceTokens,
    rangeLength?: number,
  ): Promise<void>;
  updatePlaylist?(
    playlistId: string,
    params: UpdatePlaylistParams,
    tokens: ServiceTokens,
  ): Promise<void>;
  removeFromLibrary?(
    tokens: ServiceTokens,
    songIds?: string[],
    albumIds?: string[],
  ): Promise<void>;
  getTopItems?(
    tokens: ServiceTokens,
    type: 'artists' | 'tracks',
    timeRange?: 'short_term' | 'medium_term' | 'long_term',
    limit?: number,
  ): Promise<Array<{ id: string; name: string }>>;
}
