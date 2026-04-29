import { useEffect, useState } from 'react';
import { loadConfig, type AppConfig } from '../config';

// Returns the runtime AppConfig once it has loaded. loadConfig caches the
// promise, so components mounted after the initial App-level load resolve
// synchronously on the next tick rather than refetching.
export function useAppConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}
