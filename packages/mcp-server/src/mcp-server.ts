import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ServiceTokens } from './shared/token-manager.js';
import type { MusicServiceAdapter, MusicServiceCapability } from './services/types.js';

const REGION = process.env.REGION ?? 'us-east-1';
const SHARED_PLAYLISTS_TABLE_NAME = process.env.SHARED_PLAYLISTS_TABLE_NAME ?? '';
const PORTAL_URL_ENV = process.env.PORTAL_URL ?? 'https://mixcraft.app';

const shareDdbDocClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
);

export interface ServiceEntry {
  adapter: MusicServiceAdapter;
  tokens: ServiceTokens;
}

export function createMcpServer(
  services: Map<string, ServiceEntry>,
  portalUrl: string,
  userId: string,
): McpServer {
  const server = new McpServer({
    name: 'mixcraft-app',
    version: '1.0.0',
  });

  if (services.size === 0) {
    const connectUrl = portalUrl || 'https://mixcraft.app';
    server.tool(
      'get_started',
      'Get instructions for connecting your music service to MixCraft.',
      {},
      async () => ({
        content: [
          {
            type: 'text',
            text: [
              'No music services are connected yet.',
              '',
              'To get started:',
              `1. Visit ${connectUrl}`,
              '2. Sign in to your MixCraft account',
              '3. Connect your music service (e.g. Apple Music, Spotify)',
              '4. Once connected, restart this MCP session to access your music tools',
            ].join('\n'),
          },
        ],
      }),
    );
    return server;
  }

  const prefixed = services.size > 1;

  for (const [key, entry] of services) {
    const prefix = prefixed ? key + '_' : '';
    registerBaseTools(server, entry.adapter, entry.tokens, prefix);
    registerExtraTools(server, entry.adapter, entry.tokens, prefix);
  }

  registerShareTools(server, userId);

  return server;
}

function getToolDescriptions(serviceName: string) {
  const isAppleMusic = serviceName === 'apple_music';
  return {
    search_catalog: 'Search the music catalog for songs, albums, and artists.',
    list_playlists: "List the user's library playlists.",
    get_playlist_tracks: 'Get all tracks in a specific playlist. Handles pagination automatically.',
    create_playlist: isAppleMusic
      ? "Create a new playlist in the user's music library. WARNING: Playlists created via the Apple Music API CANNOT be deleted, renamed, or modified after creation. The name and description are permanent. Please confirm with the user before calling this tool."
      : "Create a new playlist in the user's Spotify library. The playlist can be renamed, modified, or removed later.",
    add_tracks: isAppleMusic
      ? 'Append tracks to an existing playlist. WARNING: Tracks are appended only. They cannot be removed or reordered via the Apple Music API. This action is irreversible.'
      : 'Add tracks to an existing playlist. Tracks can be removed or reordered later.',
    get_recently_played: "Get the user's recently played tracks. Useful for understanding listening context and making recommendations.",
    get_library_songs: "Get songs in the user's library.",
    add_to_library: "Add songs or albums to the user's library.",
  };
}

function registerBaseTools(
  server: McpServer,
  adapter: MusicServiceAdapter,
  tokens: ServiceTokens,
  prefix: string,
): void {
  const desc = getToolDescriptions(adapter.serviceName);

  // a. search_catalog
  server.tool(
    `${prefix}search_catalog`,
    desc.search_catalog,
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
    `${prefix}list_playlists`,
    desc.list_playlists,
    {
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
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
    `${prefix}get_playlist_tracks`,
    desc.get_playlist_tracks,
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
    `${prefix}create_playlist`,
    desc.create_playlist,
    {
      name: z.string(),
      description: z.string().optional(),
      trackIds: z.array(z.string()).max(100).optional(),
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
    `${prefix}add_tracks`,
    desc.add_tracks,
    {
      playlistId: z.string(),
      trackIds: z.array(z.string()).min(1).max(100),
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
    `${prefix}get_recently_played`,
    desc.get_recently_played,
    {
      limit: z.number().min(1).max(30).optional(),
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
    `${prefix}get_library_songs`,
    desc.get_library_songs,
    {
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
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
    `${prefix}add_to_library`,
    desc.add_to_library,
    {
      songIds: z.array(z.string()).max(100).optional(),
      albumIds: z.array(z.string()).max(100).optional(),
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
}

function registerExtraTools(
  server: McpServer,
  adapter: MusicServiceAdapter,
  tokens: ServiceTokens,
  prefix: string,
): void {
  const caps = new Set<MusicServiceCapability>(adapter.supportedCapabilities);

  if (caps.has('remove_playlist') && adapter.removePlaylist) {
    server.tool(
      `${prefix}remove_playlist`,
      'Remove (unfollow) a playlist. This removes it from your library but may not permanently delete it.',
      { playlistId: z.string() },
      async ({ playlistId }) => {
        try {
          await adapter.removePlaylist!(playlistId, tokens);
          return {
            content: [{ type: 'text', text: `Successfully removed playlist ${playlistId}.` }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
      },
    );
  }

  if (caps.has('remove_tracks_from_playlist') && adapter.removeTracksFromPlaylist) {
    server.tool(
      `${prefix}remove_tracks_from_playlist`,
      'Remove specific tracks from a playlist.',
      {
        playlistId: z.string(),
        trackIds: z.array(z.string()).min(1).max(100),
      },
      async ({ playlistId, trackIds }) => {
        try {
          await adapter.removeTracksFromPlaylist!(playlistId, trackIds, tokens);
          return {
            content: [{ type: 'text', text: `Successfully removed ${trackIds.length} track(s) from playlist.` }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
      },
    );
  }

  if (caps.has('reorder_playlist_tracks') && adapter.reorderPlaylistTracks) {
    server.tool(
      `${prefix}reorder_playlist_tracks`,
      'Reorder tracks in a playlist by moving a range of tracks to a new position.',
      {
        playlistId: z.string(),
        rangeStart: z.number().min(0).describe('The position of the first track to be reordered'),
        insertBefore: z.number().min(0).describe('The position where the tracks should be inserted'),
        rangeLength: z.number().min(1).optional().describe('Number of tracks to move (default: 1)'),
      },
      async ({ playlistId, rangeStart, insertBefore, rangeLength }) => {
        try {
          await adapter.reorderPlaylistTracks!(playlistId, rangeStart, insertBefore, tokens, rangeLength);
          return {
            content: [{ type: 'text', text: 'Successfully reordered playlist tracks.' }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
      },
    );
  }

  if (caps.has('update_playlist') && adapter.updatePlaylist) {
    server.tool(
      `${prefix}update_playlist`,
      'Update a playlist name, description, or visibility.',
      {
        playlistId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        isPublic: z.boolean().optional(),
      },
      async ({ playlistId, name, description, isPublic }) => {
        try {
          await adapter.updatePlaylist!(playlistId, { name, description, isPublic }, tokens);
          return {
            content: [{ type: 'text', text: `Successfully updated playlist ${playlistId}.` }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
      },
    );
  }

  if (caps.has('remove_from_library') && adapter.removeFromLibrary) {
    server.tool(
      `${prefix}remove_from_library`,
      "Remove songs or albums from the user's library.",
      {
        songIds: z.array(z.string()).max(50).optional(),
        albumIds: z.array(z.string()).max(20).optional(),
      },
      async ({ songIds, albumIds }) => {
        try {
          await adapter.removeFromLibrary!(tokens, songIds, albumIds);
          const count = (songIds?.length ?? 0) + (albumIds?.length ?? 0);
          return {
            content: [{ type: 'text', text: `Successfully removed ${count} item(s) from library.` }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
      },
    );
  }

  if (caps.has('get_top_items') && adapter.getTopItems) {
    server.tool(
      `${prefix}get_top_items`,
      "Get the user's top artists or tracks based on listening history.",
      {
        type: z.enum(['artists', 'tracks']),
        timeRange: z.enum(['short_term', 'medium_term', 'long_term']).optional().describe('short_term (~4 weeks), medium_term (~6 months), long_term (all time)'),
        limit: z.number().min(1).max(50).optional(),
      },
      async ({ type, timeRange, limit }) => {
        try {
          const result = await adapter.getTopItems!(tokens, type, timeRange, limit);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
      },
    );
  }
}

function registerShareTools(
  server: McpServer,
  userId: string,
): void {
  // share_playlist
  server.tool(
    'share_playlist',
    'Create a public shareable link for a playlist. The shared page shows the conversation that led to the playlist, displayed as chat bubbles. ' +
    'CRITICAL: You MUST provide the actual conversation as two separate arrays — userMessages and assistantMessages. ' +
    'These are displayed side-by-side as a chat transcript. Quote BOTH sides VERBATIM — copy the exact words from the conversation. ' +
    'For the user, use their exact messages. For your own messages, use your actual words too — do NOT rewrite or summarize them. ' +
    'Include the key exchanges that shaped the playlist (initial request, suggestions, refinements, reactions). ' +
    'The arrays are interleaved: userMessages[0], assistantMessages[0], userMessages[1], etc.',
    {
      title: z.string().max(200).describe('Title of the shared playlist'),
      service: z.enum(['apple_music', 'spotify']).describe('Which music service this playlist is from'),
      playlistExternalId: z.string().optional().describe('The playlist ID on the music service, for deep linking'),
      tracks: z.array(z.string()).max(500).describe('List of tracks as "Title - Artist" strings'),
      userMessages: z.array(z.string()).max(20).describe('The user\'s VERBATIM messages from the conversation, in order. Copy their exact words.'),
      assistantMessages: z.array(z.string()).max(20).describe('Your VERBATIM responses from the conversation, in order. Copy your exact words — do NOT rewrite or paraphrase.'),
      confirm: z.boolean().describe('Must be true to create the share. If false, returns a confirmation prompt.'),
    },
    async ({ title, service, playlistExternalId, tracks: rawTracks, userMessages, assistantMessages, confirm }) => {
      try {
        if (!confirm) {
          return {
            content: [{
              type: 'text',
              text: [
                'This will create a PUBLIC link visible to anyone.',
                'The shared page will show the playlist title, tracks, and conversation summary.',
                'No account information is included.',
                '',
                'Call again with confirm: true to proceed.',
              ].join('\n'),
            }],
          };
        }

        if (!SHARED_PLAYLISTS_TABLE_NAME) {
          return {
            content: [{ type: 'text', text: 'Error: Share feature is not configured.' }],
            isError: true,
          };
        }

        // Parse "Title - Artist" or "Title - Artist (Album)" strings into objects
        const tracks = rawTracks.map((raw: string) => {
          const albumMatch = raw.match(/^(.+?)\s*-\s*(.+?)\s*\((.+)\)\s*$/);
          if (albumMatch) {
            return { title: albumMatch[1].trim(), artist: albumMatch[2].trim(), album: albumMatch[3].trim() };
          }
          const parts = raw.split(' - ');
          if (parts.length >= 2) {
            return { title: parts[0].trim(), artist: parts.slice(1).join(' - ').trim() };
          }
          return { title: raw.trim(), artist: 'Unknown' };
        });

        const shareId = crypto.randomBytes(16).toString('base64url').slice(0, 21);
        const now = new Date().toISOString();

        await shareDdbDocClient.send(
          new PutCommand({
            TableName: SHARED_PLAYLISTS_TABLE_NAME,
            Item: {
              shareId,
              userId,
              title,
              service,
              playlistExternalId: playlistExternalId ?? null,
              tracks,
              trackCount: tracks.length,
              userMessages: userMessages ?? [],
              assistantMessages: assistantMessages ?? [],
              createdAt: now,
              isDeleted: false,
            },
          }),
        );

        const shareUrl = `${PORTAL_URL_ENV}/share/${shareId}`;

        return {
          content: [{
            type: 'text',
            text: [
              'Playlist shared successfully!',
              '',
              `Share URL: ${shareUrl}`,
              `Share ID: ${shareId}`,
            ].join('\n'),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // list_shared_playlists
  server.tool(
    'list_shared_playlists',
    'List your shared playlists.',
    {
      limit: z.number().min(1).max(100).optional().describe('Maximum number of results to return (default: 20)'),
    },
    async ({ limit }) => {
      try {
        if (!SHARED_PLAYLISTS_TABLE_NAME) {
          return {
            content: [{ type: 'text', text: 'Error: Share feature is not configured.' }],
            isError: true,
          };
        }

        const effectiveLimit = limit ?? 20;

        const result = await shareDdbDocClient.send(
          new QueryCommand({
            TableName: SHARED_PLAYLISTS_TABLE_NAME,
            IndexName: 'UserIdCreatedAtIndex',
            KeyConditionExpression: 'userId = :uid',
            FilterExpression: 'isDeleted = :false',
            ExpressionAttributeValues: {
              ':uid': userId,
              ':false': false,
            },
            ScanIndexForward: false,
            Limit: effectiveLimit,
          }),
        );

        const shares = (result.Items ?? []).map((item) => ({
          shareId: item['shareId'],
          title: item['title'],
          service: item['service'],
          trackCount: Array.isArray(item['tracks']) ? item['tracks'].length : 0,
          createdAt: item['createdAt'],
          shareUrl: `${PORTAL_URL_ENV}/share/${item['shareId']}`,
        }));

        return {
          content: [{
            type: 'text',
            text: shares.length > 0
              ? JSON.stringify(shares, null, 2)
              : 'No shared playlists found.',
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // delete_shared_playlist
  server.tool(
    'delete_shared_playlist',
    'Delete a shared playlist by marking it as removed. The share link will no longer work.',
    {
      shareId: z.string().describe('The share ID to delete'),
    },
    async ({ shareId }) => {
      try {
        if (!SHARED_PLAYLISTS_TABLE_NAME) {
          return {
            content: [{ type: 'text', text: 'Error: Share feature is not configured.' }],
            isError: true,
          };
        }

        // Verify the share belongs to this user
        const existing = await shareDdbDocClient.send(
          new GetCommand({
            TableName: SHARED_PLAYLISTS_TABLE_NAME,
            Key: { shareId },
          }),
        );

        if (!existing.Item) {
          return {
            content: [{ type: 'text', text: `Error: Share ${shareId} not found.` }],
            isError: true,
          };
        }

        if (existing.Item['userId'] !== userId) {
          return {
            content: [{ type: 'text', text: 'Error: You do not own this shared playlist.' }],
            isError: true,
          };
        }

        if (existing.Item['isDeleted'] === true) {
          return {
            content: [{ type: 'text', text: `Share ${shareId} was already deleted.` }],
          };
        }

        await shareDdbDocClient.send(
          new UpdateCommand({
            TableName: SHARED_PLAYLISTS_TABLE_NAME,
            Key: { shareId },
            UpdateExpression: 'SET isDeleted = :true, deletedAt = :now',
            ExpressionAttributeValues: {
              ':true': true,
              ':now': new Date().toISOString(),
            },
          }),
        );

        return {
          content: [{ type: 'text', text: `Successfully deleted shared playlist ${shareId}.` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );
}
