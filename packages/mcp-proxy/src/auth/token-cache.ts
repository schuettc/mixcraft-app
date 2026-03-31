import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface CachedToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const TOKEN_DIR = path.join(os.homedir(), '.mixcraft');
const TOKEN_PATH = path.join(TOKEN_DIR, 'token.json');

export function loadCachedToken(): CachedToken | null {
  if (!fs.existsSync(TOKEN_PATH)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(TOKEN_PATH, 'utf-8');
    return JSON.parse(raw) as CachedToken;
  } catch {
    return null;
  }
}

export function saveCachedToken(token: CachedToken): void {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), { mode: 0o600 });
}

export function isTokenExpired(token: CachedToken): boolean {
  return Date.now() >= token.expiresAt - 60_000; // 60s buffer
}
