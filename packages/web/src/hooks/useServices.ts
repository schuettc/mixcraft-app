import { useState, useCallback, useEffect } from 'react';
import { useApi } from './useApi';

export interface ServiceStatus {
  connected: boolean;
  connectedAt: string;
}

export interface AllServicesStatus {
  apple_music: ServiceStatus;
  spotify: ServiceStatus;
}

const DEFAULT_STATUS: AllServicesStatus = {
  apple_music: { connected: false, connectedAt: '' },
  spotify: { connected: false, connectedAt: '' },
};

export function useServices() {
  const { apiFetch } = useApi();
  const [services, setServices] = useState<AllServicesStatus>(DEFAULT_STATUS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await apiFetch('/api/services/status');
      setServices(result.services);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services');
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const result = await apiFetch('/api/services/status');
        if (!cancelled) setServices(result.services);
      } catch {
        // Ignore on init
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = useCallback(async (provider: string) => {
    setError(null);
    try {
      await apiFetch(`/api/services/${provider}/disconnect`, { method: 'POST' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
    }
  }, [apiFetch, refresh]);

  const hasAnyService = services.apple_music.connected || services.spotify.connected;

  return { services, isLoading, error, refresh, disconnect, hasAnyService };
}
