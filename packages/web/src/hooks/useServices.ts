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

  // Merge with DEFAULT_STATUS so any provider missing from the API
  // response (e.g. spotify on a deployment with the flag off) still has a
  // defined ServiceStatus shape — prevents `services.spotify.connected`
  // crashes if the contract ever drifts again.
  const mergeStatus = (incoming: Partial<AllServicesStatus> | undefined): AllServicesStatus => ({
    ...DEFAULT_STATUS,
    ...(incoming ?? {}),
  });

  const refresh = useCallback(async () => {
    try {
      const result = await apiFetch('/api/services/status');
      setServices(mergeStatus(result.services));
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
        if (!cancelled) setServices(mergeStatus(result.services));
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

  const hasAnyService = services.apple_music.connected || services.spotify?.connected;

  return { services, isLoading, error, refresh, disconnect, hasAnyService };
}
