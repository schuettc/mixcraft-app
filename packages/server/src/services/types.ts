export { UserTokens } from '../shared/token-manager.js';

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

export interface MusicServiceAdapter {
  readonly serviceName: string;
  searchCatalog(params: SearchParams): Promise<SearchResult>;
  listPlaylists(
    tokens: { developerToken: string; userToken: string },
    limit?: number,
    offset?: number,
  ): Promise<Playlist[]>;
  getPlaylistTracks(
    playlistId: string,
    tokens: { developerToken: string; userToken: string },
  ): Promise<Track[]>;
  createPlaylist(
    name: string,
    tokens: { developerToken: string; userToken: string },
    description?: string,
    trackIds?: string[],
  ): Promise<CreatePlaylistResult>;
  addTracks(
    playlistId: string,
    trackIds: string[],
    tokens: { developerToken: string; userToken: string },
  ): Promise<void>;
  getRecentlyPlayed(
    tokens: { developerToken: string; userToken: string },
    limit?: number,
  ): Promise<Track[]>;
  getLibrarySongs(
    tokens: { developerToken: string; userToken: string },
    limit?: number,
    offset?: number,
  ): Promise<Track[]>;
  addToLibrary(
    tokens: { developerToken: string; userToken: string },
    songIds?: string[],
    albumIds?: string[],
  ): Promise<void>;
}
