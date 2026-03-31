import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadCachedToken, saveCachedToken, type CachedToken } from './token-cache.js';

vi.mock('node:fs');
vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}));

const mockFs = vi.mocked(fs);

describe('token-cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadCachedToken', () => {
    it('returns null when token file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = loadCachedToken();

      expect(result).toBeNull();
    });

    it('returns token when file exists and token is not expired', () => {
      const token: CachedToken = {
        accessToken: 'access_123',
        refreshToken: 'refresh_456',
        expiresAt: Date.now() + 3600_000,
      };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(token));

      const result = loadCachedToken();

      expect(result).toEqual(token);
    });

    it('returns token even if expired (caller decides refresh)', () => {
      const token: CachedToken = {
        accessToken: 'access_123',
        refreshToken: 'refresh_456',
        expiresAt: Date.now() - 1000,
      };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(token));

      const result = loadCachedToken();

      expect(result).toEqual(token);
    });

    it('returns null when file contains invalid JSON', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('not json');

      const result = loadCachedToken();

      expect(result).toBeNull();
    });
  });

  describe('saveCachedToken', () => {
    it('creates directory and writes token file', () => {
      mockFs.mkdirSync.mockReturnValue(undefined);
      mockFs.writeFileSync.mockReturnValue(undefined);

      const token: CachedToken = {
        accessToken: 'access_123',
        refreshToken: 'refresh_456',
        expiresAt: Date.now() + 3600_000,
      };

      saveCachedToken(token);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        '/home/testuser/.mixcraft',
        { recursive: true },
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/home/testuser/.mixcraft/token.json',
        JSON.stringify(token, null, 2),
        { mode: 0o600 },
      );
    });
  });
});
