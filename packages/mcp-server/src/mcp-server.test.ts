import { describe, it, expect, vi } from 'vitest';
import { createMcpServer, type ServiceEntry } from './mcp-server.js';
import { AppleMusicAdapter } from './services/apple-music/adapter.js';

// Mock the adapter — we only need the class shape, not real API calls
vi.mock('./services/apple-music/adapter.js', () => ({
  AppleMusicAdapter: vi.fn(),
}));

function getToolNames(server: unknown): string[] {
  const tools = (server as { _registeredTools: Record<string, unknown> })._registeredTools;
  return Object.keys(tools);
}

function getToolCallback(server: unknown, name: string): (args: Record<string, never>) => Promise<{ content: { type: string; text: string }[] }> {
  const tools = (server as { _registeredTools: Record<string, { handler: (args: Record<string, never>) => Promise<{ content: { type: string; text: string }[] }> }> })._registeredTools;
  return tools[name].handler;
}

function makeAppleMusicEntry(): ServiceEntry {
  return {
    adapter: new AppleMusicAdapter('fake-dev-token'),
    tokens: { developerToken: 'fake-dev-token', userToken: 'fake-user-token' },
  };
}

describe('createMcpServer', () => {
  it('registers only get_started when no services connected', () => {
    const services = new Map<string, ServiceEntry>();
    const server = createMcpServer(services, 'https://mixcraft.app');
    const tools = getToolNames(server);

    expect(tools).toEqual(['get_started']);
  });

  it('get_started tool includes portal URL in response', async () => {
    const services = new Map<string, ServiceEntry>();
    const portalUrl = 'https://mixcraft.app';
    const server = createMcpServer(services, portalUrl);

    const handler = getToolCallback(server, 'get_started');
    const result = await handler({});

    expect(result.content[0].text).toContain(portalUrl);
    expect(result.content[0].text).toContain('No music services are connected');
  });

  it('registers all 8 Apple Music tools when apple_music is connected', () => {
    const services = new Map<string, ServiceEntry>();
    services.set('apple_music', makeAppleMusicEntry());
    const server = createMcpServer(services, 'https://mixcraft.app');
    const tools = getToolNames(server);

    const expectedTools = [
      'search_catalog',
      'list_playlists',
      'get_playlist_tracks',
      'create_playlist',
      'add_tracks',
      'get_recently_played',
      'get_library_songs',
      'add_to_library',
    ];

    expect(tools).toEqual(expectedTools);
  });

  it('does not register get_started when services are connected', () => {
    const services = new Map<string, ServiceEntry>();
    services.set('apple_music', makeAppleMusicEntry());
    const server = createMcpServer(services, 'https://mixcraft.app');
    const tools = getToolNames(server);

    expect(tools).not.toContain('get_started');
  });
});
