import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppleMusicAdapter } from './services/apple-music/adapter.js';
import type { UserTokens } from './shared/token-manager.js';

export function createMcpServer(
  adapter: AppleMusicAdapter,
  tokens: UserTokens,
): McpServer {
  const server = new McpServer({
    name: 'mixcraft-app',
    version: '1.0.0',
  });

  // a. search_catalog
  server.tool(
    'search_catalog',
    'Search the music catalog for songs, albums, and artists.',
    {
      query: z.string(),
      types: z
        .string()
        .optional()
        .describe('Comma-separated: songs,albums,artists'),
      storefront: z.string().optional().default('us'),
      limit: z.number().min(1).max(25).optional().default(10),
    },
    async ({ query, types, storefront, limit }) => {
      try {
        const result = await adapter.searchCatalog({
          query,
          types: types ? types.split(',') : undefined,
          storefront,
          limit,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // b. list_playlists
  server.tool(
    'list_playlists',
    "List the user's library playlists.",
    {
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async ({ limit, offset }) => {
      try {
        const result = await adapter.listPlaylists(tokens, limit, offset);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // c. get_playlist_tracks
  server.tool(
    'get_playlist_tracks',
    'Get all tracks in a specific playlist. Handles pagination automatically.',
    {
      playlistId: z.string(),
    },
    async ({ playlistId }) => {
      try {
        const result = await adapter.getPlaylistTracks(playlistId, tokens);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // d. create_playlist
  server.tool(
    'create_playlist',
    "Create a new playlist in the user's music library. WARNING: Playlists created via the Apple Music API CANNOT be deleted, renamed, or modified after creation. The name and description are permanent. Please confirm with the user before calling this tool.",
    {
      name: z.string(),
      description: z.string().optional(),
      trackIds: z.array(z.string()).optional(),
    },
    async ({ name, description, trackIds }) => {
      try {
        const result = await adapter.createPlaylist(
          name,
          tokens,
          description,
          trackIds,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // e. add_tracks
  server.tool(
    'add_tracks',
    'Append tracks to an existing playlist. WARNING: Tracks are appended only. They cannot be removed or reordered via the Apple Music API. This action is irreversible.',
    {
      playlistId: z.string(),
      trackIds: z.array(z.string()),
    },
    async ({ playlistId, trackIds }) => {
      try {
        await adapter.addTracks(playlistId, trackIds, tokens);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully added ${trackIds.length} track(s) to playlist ${playlistId}.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // f. get_recently_played
  server.tool(
    'get_recently_played',
    "Get the user's recently played tracks. Useful for understanding listening context and making recommendations.",
    {
      limit: z.number().optional(),
    },
    async ({ limit }) => {
      try {
        const result = await adapter.getRecentlyPlayed(tokens, limit);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // g. get_library_songs
  server.tool(
    'get_library_songs',
    "Get songs in the user's library.",
    {
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async ({ limit, offset }) => {
      try {
        const result = await adapter.getLibrarySongs(tokens, limit, offset);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // h. add_to_library
  server.tool(
    'add_to_library',
    "Add songs or albums to the user's library.",
    {
      songIds: z.array(z.string()).optional(),
      albumIds: z.array(z.string()).optional(),
    },
    async ({ songIds, albumIds }) => {
      try {
        await adapter.addToLibrary(tokens, songIds, albumIds);
        const count =
          (songIds?.length ?? 0) + (albumIds?.length ?? 0);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully added ${count} item(s) to library.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}
