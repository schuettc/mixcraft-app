import { useEffect, useRef, useState, useCallback } from 'react';
import { useSession } from '@clerk/clerk-react';
import { useApi } from './useApi';
import { useAppConfig } from './useAppConfig';

interface SyncFailure {
  provider: string;
  reason: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * After sign-in, detect if the user authenticated via a social provider
 * (Spotify or Apple) and auto-sync the OAuth token to our backend.
 *
 * Retries up to 3 times with backoff if the token isn't ready in Clerk yet.
 * Reports failures via the returned `syncFailures` array so the UI can alert.
 */
export function useServiceSync(onSynced?: () => void) {
  const { session } = useSession();
  const { apiFetch } = useApi();
  const config = useAppConfig();
  const enableSpotify = config?.enableSpotify ?? false;
  const syncedRef = useRef(false);
  const [syncFailures, setSyncFailures] = useState<SyncFailure[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const dismissFailure = useCallback((provider: string) => {
    setSyncFailures((prev) => prev.filter((f) => f.provider !== provider));
  }, []);

  useEffect(() => {
    if (!session || syncedRef.current) return;

    async function trySyncProvider(
      internalProvider: string,
    ): Promise<{ synced: boolean; reason?: string }> {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          await sleep(RETRY_DELAY_MS * attempt);
        }

        try {
          const result = await apiFetch('/api/services/sync-from-clerk', {
            method: 'POST',
            body: JSON.stringify({ provider: internalProvider }),
          });

          if (result.synced) {
            return { synced: true };
          }

          // Token not found in Clerk yet — retry
          if (attempt < MAX_RETRIES - 1) {
            continue;
          }

          return {
            synced: false,
            reason: result.reason || 'Token not available from login provider',
          };
        } catch (err) {
          if (attempt < MAX_RETRIES - 1) {
            continue;
          }
          return {
            synced: false,
            reason: err instanceof Error ? err.message : 'Sync request failed',
          };
        }
      }

      return { synced: false, reason: 'Max retries exceeded' };
    }

    async function syncSocialProviders() {
      const externalAccounts = session?.user?.externalAccounts;
      if (!externalAccounts || externalAccounts.length === 0) return;

      syncedRef.current = true;
      setIsSyncing(true);

      const failures: SyncFailure[] = [];
      let anySynced = false;

      for (const account of externalAccounts) {
        const provider = String(account.provider);
        let internalProvider: string | null = null;

        if (provider === 'oauth_spotify') {
          // Skip Spotify token sync entirely on deployments without Spotify
          // support — the API would 400 and we'd surface a confusing failure
          // banner. Users who logged in via Spotify can still browse the
          // portal; they just won't get a Spotify connection.
          if (!enableSpotify) continue;
          internalProvider = 'spotify';
        } else if (provider === 'oauth_apple') {
          internalProvider = 'apple_music';
        }

        if (internalProvider) {
          const result = await trySyncProvider(internalProvider);
          if (result.synced) {
            anySynced = true;
          } else {
            failures.push({
              provider: internalProvider === 'spotify' ? 'Spotify' : 'Apple Music',
              reason: result.reason ?? 'Unknown error',
            });
          }
        }
      }

      setIsSyncing(false);

      if (failures.length > 0) {
        setSyncFailures(failures);
        // Allow retry on next mount if there were failures
        syncedRef.current = false;
      }

      if (anySynced) {
        onSynced?.();
      }
    }

    syncSocialProviders();
  }, [session, apiFetch, onSynced, enableSpotify]);

  return { syncFailures, isSyncing, dismissFailure };
}
