// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());

vi.mock('./useApi', () => ({
  useApi: () => ({ apiFetch }),
}));

import { useAppleMusic } from './useAppleMusic';

describe('useAppleMusic', () => {
  const configure = vi.fn();
  const authorize = vi.fn();
  const unauthorize = vi.fn();
  const getInstance = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    configure.mockResolvedValue(undefined);
    authorize.mockResolvedValue('fresh-user-token');
    unauthorize.mockResolvedValue(undefined);
    getInstance.mockReturnValue({
      isAuthorized: true,
      musicUserToken: 'stale-user-token',
      authorize,
      unauthorize,
    });
    Object.defineProperty(window, 'MusicKit', {
      configurable: true,
      value: { configure, getInstance },
    });
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/apple-music/status') return { connected: true };
      if (path === '/api/apple-music/developer-token') {
        return { developerToken: 'developer-token' };
      }
      return { success: true };
    });
  });

  it('unauthorizes MusicKit after a fresh page load before disconnecting the service', async () => {
    const { result } = renderHook(() => useAppleMusic());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.unauthorize();
    });

    expect(configure).toHaveBeenCalledWith({
      developerToken: 'developer-token',
      app: { name: 'MixCraft', build: '1.0.0' },
    });
    expect(unauthorize).toHaveBeenCalledOnce();
    expect(apiFetch).toHaveBeenCalledWith('/api/apple-music/disconnect', {
      method: 'POST',
    });
    const disconnectCall = apiFetch.mock.calls.findIndex(
      ([path]) => path === '/api/apple-music/disconnect',
    );
    expect(unauthorize.mock.invocationCallOrder[0]).toBeLessThan(
      apiFetch.mock.invocationCallOrder[disconnectCall],
    );
  });

  it('can clear the backend connection when MusicKit is already unauthorized', async () => {
    getInstance.mockReturnValue({
      isAuthorized: false,
      musicUserToken: 'stale-user-token',
      authorize,
      unauthorize,
    });
    const { result } = renderHook(() => useAppleMusic());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.unauthorize();
    });

    expect(unauthorize).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledWith('/api/apple-music/disconnect', {
      method: 'POST',
    });
    expect(result.current.isAuthorized).toBe(false);
  });

  it('stores the fresh user token returned by MusicKit authorize', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/api/apple-music/status') return { connected: false };
      if (path === '/api/apple-music/developer-token') {
        return { developerToken: 'developer-token' };
      }
      return { success: true };
    });
    const { result } = renderHook(() => useAppleMusic());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.authorize();
    });

    expect(apiFetch).toHaveBeenCalledWith('/api/apple-music/connect', {
      method: 'POST',
      body: JSON.stringify({ musicUserToken: 'fresh-user-token' }),
    });
  });
});
