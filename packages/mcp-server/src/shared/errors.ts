export class MusicMcpError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class AuthenticationError extends MusicMcpError {
  /** HTTP status the auth provider returned, when the failure came from it. */
  readonly upstreamStatus?: number;

  constructor(message = 'Invalid API key', upstreamStatus?: number) {
    super(message, 'AUTHENTICATION_ERROR');
    this.upstreamStatus = upstreamStatus;
  }
}

/**
 * The auth provider (Clerk) could not be reached or failed to answer. The
 * presented token was never actually judged, so this is our outage, not a bad
 * credential — keep it distinct from AuthenticationError so a Clerk incident
 * is visible in logs and metrics instead of masquerading as expired tokens.
 */
export class UpstreamAuthError extends MusicMcpError {
  readonly upstreamStatus?: number;

  constructor(upstreamStatus?: number, cause?: unknown) {
    super('Auth provider unavailable', 'UPSTREAM_AUTH_ERROR');
    this.upstreamStatus = upstreamStatus;
    this.cause = cause;
  }
}

export class TokenExpiredError extends MusicMcpError {
  readonly portalUrl: string;

  constructor(portalUrl: string, message?: string) {
    super(
      message ?? `Music token expired. Re-authorize at ${portalUrl}`,
      'TOKEN_EXPIRED',
    );
    this.portalUrl = portalUrl;
  }
}

export class SpotifyTokenExpiredError extends TokenExpiredError {
  constructor(portalUrl: string) {
    super(
      portalUrl,
      'Spotify access token expired. Re-authorize at ' + portalUrl,
    );
  }
}

export class RateLimitError extends MusicMcpError {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number, message?: string) {
    super(
      message ?? `Rate limited. Retry after ${retryAfterMs}ms`,
      'RATE_LIMIT',
    );
    this.retryAfterMs = retryAfterMs;
  }
}

export class MusicServiceError extends MusicMcpError {
  readonly statusCode: number;

  constructor(statusCode: number, message?: string) {
    super(
      message ?? `Music service returned status ${statusCode}`,
      'MUSIC_SERVICE_ERROR',
    );
    this.statusCode = statusCode;
  }
}
