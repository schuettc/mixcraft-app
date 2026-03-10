export interface AppConfig {
  portalApiUrl: string;
  clerkPublishableKey: string;
}

let configPromise: Promise<AppConfig> | null = null;

export function loadConfig(): Promise<AppConfig> {
  if (!configPromise) {
    configPromise = fetch('/config.json').then((res) => {
      if (!res.ok) throw new Error('Failed to load config.json');
      return res.json() as Promise<AppConfig>;
    });
  }
  return configPromise;
}
