import { MusicServiceError, RateLimitError, SpotifyTokenExpiredError } from '../../shared/errors.js';

export const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export async function spotifyFetch(
  endpoint: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<unknown> {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${SPOTIFY_API_BASE}${endpoint}`;

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Content-Type', 'application/json');

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 204) {
      return null;
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : INITIAL_BACKOFF_MS;
      lastError = new RateLimitError(
        retryMs,
        `Spotify API rate limit hit (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
      );
      if (attempt < MAX_RETRIES) {
        continue;
      }
      throw lastError;
    }

    if (response.status === 401) {
      throw new SpotifyTokenExpiredError('');
    }

    if (response.status === 403) {
      throw new MusicServiceError(
        403,
        'Spotify API error 403: insufficient scopes for this request',
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new MusicServiceError(
        response.status,
        `Spotify API error ${response.status}: ${body}`,
      );
    }

    return (await response.json()) as unknown;
  }

  throw lastError ?? new MusicServiceError(0, 'Unexpected fetch failure');
}
