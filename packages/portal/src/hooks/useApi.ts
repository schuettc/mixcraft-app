import { useAuth } from '@clerk/clerk-react';

export function useApi() {
  const { getToken } = useAuth();

  async function apiFetch(path: string, options?: RequestInit) {
    const token = await getToken();
    const res = await fetch(`${import.meta.env.VITE_PORTAL_API_URL}${path}`, {
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
