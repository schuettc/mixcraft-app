import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { loadConfig } from '../config';

export interface SharedPlaylistSummary {
  shareId: string;
  shareUrl: string;
  title: string;
  service: string;
  trackCount: number;
  createdAt: string;
}

export function useSharedPlaylists() {
  const { getToken } = useAuth();
  const [shares, setShares] = useState<SharedPlaylistSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchShares = useCallback(async () => {
    try {
      const [config, token] = await Promise.all([loadConfig(), getToken()]);
      const res = await fetch(`${config.portalApiUrl}/api/shared-playlists`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch shared playlists');
      const data = await res.json();
      setShares(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  const deleteShare = useCallback(async (shareId: string) => {
    const [config, token] = await Promise.all([loadConfig(), getToken()]);
    const res = await fetch(`${config.portalApiUrl}/api/shared-playlists/${shareId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to delete shared playlist');
    setShares((prev) => prev.filter((s) => s.shareId !== shareId));
  }, [getToken]);

  return { shares, isLoading, error, deleteShare, refresh: fetchShares };
}
