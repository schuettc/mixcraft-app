import { useEffect, useState } from 'react';
import { loadConfig } from '../config';

export interface TrackData {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}

export interface SharedPlaylistData {
  shareId: string;
  title: string;
  service: 'apple_music' | 'spotify';
  playlistExternalId: string | null;
  trackCount: number;
  tracks: TrackData[];
  conversationSummary: string | null;
  userMessages: string[];
  assistantMessages: string[];
  createdAt: string;
}

export type ShareStatus = 'loading' | 'ready' | 'not_found' | 'error';

export function useShareData(shareId: string) {
  const [data, setData] = useState<SharedPlaylistData | null>(null);
  const [status, setStatus] = useState<ShareStatus>('loading');

  useEffect(() => {
    loadConfig()
      .then((config) => fetch(`${config.portalApiUrl}/api/shared-playlists/${shareId}`))
      .then((res) => {
        if (res.status === 404) {
          setStatus('not_found');
          return null;
        }
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json) {
          setData(json);
          setStatus('ready');
        }
      })
      .catch(() => setStatus('error'));
  }, [shareId]);

  return { data, status };
}
