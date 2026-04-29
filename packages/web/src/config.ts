export interface AppConfig {
  portalApiUrl: string;
  clerkPublishableKey: string;
  // Whether this deployment exposes Spotify integration. Spotify's developer
  // program restricts apps to an allowlist that cannot be expanded for
  // public distribution, so the hosted mixcraft.app deploy ships with this
  // off. Self-hosted forks set CDK context `enableSpotify=true` to enable.
  enableSpotify: boolean;
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
