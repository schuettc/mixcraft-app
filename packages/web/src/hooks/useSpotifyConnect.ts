import { useState, useEffect, useCallback, useRef } from 'react';
import { useApi } from './useApi';

export function useSpotifyConnect(onConnected?: () => void) {
  const { apiFetch } = useApi();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  // Listen for postMessage from the popup
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'spotify-connected') {
        setIsConnecting(false);
        setError(null);
        popupRef.current = null;
        onConnected?.();
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onConnected]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const { url } = await apiFetch('/api/spotify/auth-url');

      // Open centered popup
      const width = 500;
      const height = 700;
      const left = window.screenX + (window.innerWidth - width) / 2;
      const top = window.screenY + (window.innerHeight - height) / 2;

      const popup = window.open(
        url,
        'spotify-connect',
        `width=${width},height=${height},left=${left},top=${top},popup=yes`,
      );

      if (!popup) {
        setError('Popup was blocked. Please allow popups for this site and try again.');
        setIsConnecting(false);
        return;
      }

      popupRef.current = popup;

      // Poll for popup close (in case user closes it manually)
      const pollTimer = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollTimer);
          // Give a brief moment for postMessage to arrive
          setTimeout(() => {
            if (popupRef.current === popup) {
              setIsConnecting(false);
              popupRef.current = null;
            }
          }, 500);
        }
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Spotify connection');
      setIsConnecting(false);
    }
  }, [apiFetch]);

  return { connect, isConnecting, error };
}
