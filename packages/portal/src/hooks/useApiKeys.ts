import { useState, useCallback, useEffect } from 'react';
import { useApi } from './useApi';

export interface ApiKeyInfo {
  keyHash: string;
  keyPrefix: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  isActive: boolean;
}

export interface CreateKeyResult {
  rawKey: string;
  keyPrefix: string;
  name: string;
  createdAt: string;
}

export function useApiKeys() {
  const { apiFetch } = useApi();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const listKeys = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/keys');
      setKeys(data.keys ?? data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load keys');
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch]);

  const createKey = useCallback(
    async (name: string): Promise<CreateKeyResult> => {
      const result = await apiFetch('/api/keys', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await listKeys();
      return result;
    },
    [apiFetch, listKeys],
  );

  const revokeKey = useCallback(
    async (keyHash: string) => {
      await apiFetch(`/api/keys/${keyHash}`, { method: 'DELETE' });
      await listKeys();
    },
    [apiFetch, listKeys],
  );

  useEffect(() => {
    listKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { keys, isLoading, error, createKey, revokeKey, refresh: listKeys };
}
