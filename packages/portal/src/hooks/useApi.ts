import { useAuth } from '@clerk/clerk-react';
import { loadConfig } from '../config';

export function useApi() {
  const { getToken } = useAuth();

  async function apiFetch(path: string, options?: RequestInit) {
    const [token, config] = await Promise.all([getToken(), loadConfig()]);
    const res = await fetch(`${config.portalApiUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options?.headers,
      },
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  return { apiFetch };
}
