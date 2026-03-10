export class MusicMcpError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class AuthenticationError extends MusicMcpError {
  constructor(message = 'Invalid API key') {
    super(message, 'AUTHENTICATION_ERROR');
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
