export {
  MusicMcpError,
  AuthenticationError,
  TokenExpiredError,
  SpotifyTokenExpiredError,
  RateLimitError,
  MusicServiceError,
} from './errors.js';

export { getSecret } from './secrets.js';

export {
  encryptToken,
  decryptToken,
  getUserTokens,
  storeUserTokens,
} from './token-manager.js';

export type {
  UserTokens,
  AppleMusicTokens,
  SpotifyTokens,
  ServiceTokens,
  ConnectedService,
} from './token-manager.js';
