import { useEffect, useRef } from 'react';
import { useSession } from '@clerk/clerk-react';
import { useApi } from './useApi';

/**
 * After sign-in, detect if the user authenticated via a social provider
 * (Spotify or Apple) and auto-sync the OAuth token to our backend.
 */
export function useServiceSync(onSynced?: () => void) {
  const { session } = useSession();
  const { apiFetch } = useApi();
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!session || syncedRef.current) return;

    async function syncSocialProvider() {
      // Clerk exposes the external account providers on the session's user
      const externalAccounts = session?.user?.externalAccounts;
      if (!externalAccounts || externalAccounts.length === 0) return;

      syncedRef.current = true;

      for (const account of externalAccounts) {
        const provider = String(account.provider);
        let internalProvider: string | null = null;

        if (provider === 'oauth_spotify') {
          internalProvider = 'spotify';
        } else if (provider === 'oauth_apple') {
          internalProvider = 'apple_music';
        }

        if (internalProvider) {
          try {
            const result = await apiFetch('/api/services/sync-from-clerk', {
              method: 'POST',
              body: JSON.stringify({ provider: internalProvider }),
            });
            if (result.synced) {
              onSynced?.();
            }
          } catch {
            // Non-critical — user can manually connect later
          }
        }
      }
    }

    syncSocialProvider();
  }, [session, apiFetch, onSynced]);
}
