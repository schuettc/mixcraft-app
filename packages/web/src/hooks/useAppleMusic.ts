import { useState, useCallback, useEffect, useRef } from 'react';
import { useApi } from './useApi';

declare global {
  interface Window {
    MusicKit: {
      configure: (options: {
        developerToken: string;
        app: { name: string; build: string };
      }) => Promise<void>;
      getInstance: () => MusicKitInstance;
    };
  }
}

interface MusicKitInstance {
  isAuthorized: boolean;
  musicUserToken: string;
  authorize: () => Promise<string>;
  unauthorize: () => Promise<void>;
}

function waitForMusicKit(): Promise<typeof window.MusicKit> {
  return new Promise((resolve) => {
    if (window.MusicKit) {
      resolve(window.MusicKit);
      return;
    }
    document.addEventListener('musickitloaded', () => {
      resolve(window.MusicKit);
    });
  });
}

export function useAppleMusic() {
  const { apiFetch } = useApi();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const musicKitRef = useRef<MusicKitInstance | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const { connected } = await apiFetch('/api/apple-music/status');
        if (!cancelled) setIsAuthorized(connected);
      } catch {
        // Ignore — user may not be connected yet
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const authorize = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { developerToken } = await apiFetch(
        '/api/apple-music/developer-token',
      );

      const MusicKit = await waitForMusicKit();
      await MusicKit.configure({
        developerToken,
        app: { name: 'MixCraft', build: '1.0.0' },
      });
      const instance = MusicKit.getInstance();
      musicKitRef.current = instance;

      await instance.authorize();
      const musicUserToken = instance.musicUserToken;

      await apiFetch('/api/apple-music/connect', {
        method: 'POST',
        body: JSON.stringify({ musicUserToken }),
      });

      setIsAuthorized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization failed');
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch]);

  const unauthorize = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (musicKitRef.current) {
        await musicKitRef.current.unauthorize();
      }
      await apiFetch('/api/apple-music/disconnect', { method: 'POST' });
      setIsAuthorized(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnection failed');
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch]);

  return { isAuthorized, isLoading, error, authorize, unauthorize };
}
