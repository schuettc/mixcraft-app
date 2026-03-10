import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => {
  const mockSend = vi.fn();
  return { mockSend };
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  GetCommand: vi.fn(),
  UpdateCommand: vi.fn(),
}));

import { hashApiKey, generateApiKey, validateApiKey } from './api-key.js';
import { AuthenticationError } from '../shared/errors.js';

beforeAll(() => {
  process.env.API_KEYS_TABLE_NAME = 'test-table';
});

beforeEach(() => {
  mockSend.mockReset();
});

describe('hashApiKey', () => {
  it('produces consistent SHA-256 hex output', () => {
    const hash1 = hashApiKey('test-key');
    const hash2 = hashApiKey('test-key');
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different inputs', () => {
    const hash1 = hashApiKey('key-a');
    const hash2 = hashApiKey('key-b');
    expect(hash1).not.toBe(hash2);
  });
});

describe('generateApiKey', () => {
  it('returns rawKey starting with mx_', () => {
    const { rawKey } = generateApiKey();
    expect(rawKey.startsWith('mx_')).toBe(true);
  });

  it('returns rawKey of correct length (mx_ + 32 hex chars = 35)', () => {
    const { rawKey } = generateApiKey();
    expect(rawKey).toHaveLength(35);
    expect(rawKey.slice(3)).toMatch(/^[a-f0-9]{32}$/);
  });

  it('returns keyHash matching hashApiKey(rawKey)', () => {
    const { rawKey, keyHash } = generateApiKey();
    expect(keyHash).toBe(hashApiKey(rawKey));
  });

  it('produces unique keys each call', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.rawKey).not.toBe(b.rawKey);
    expect(a.keyHash).not.toBe(b.keyHash);
  });
});

describe('validateApiKey', () => {
  it('rejects key not starting with mx_', async () => {
    await expect(validateApiKey('bad_key')).rejects.toThrow(AuthenticationError);
    await expect(validateApiKey('bad_key')).rejects.toThrow('Invalid API key format');
  });

  it('rejects key not found in DB', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    await expect(validateApiKey('mx_abcdef1234567890abcdef1234567890')).rejects.toThrow(
      AuthenticationError,
    );
    await expect(
      (async () => {
        mockSend.mockResolvedValueOnce({ Item: undefined });
        await validateApiKey('mx_abcdef1234567890abcdef1234567890');
      })(),
    ).rejects.toThrow('Invalid API key');
  });

  it('rejects inactive key', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        userId: 'user-1',
        keyPrefix: 'mx_abc',
        name: 'test',
        isActive: false,
      },
    });

    await expect(validateApiKey('mx_abcdef1234567890abcdef1234567890')).rejects.toThrow(
      AuthenticationError,
    );
  });

  it('returns ApiKeyRecord for valid active key', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        userId: 'user-1',
        keyPrefix: 'mx_abc',
        name: 'my-key',
        isActive: true,
      },
    });
    // The fire-and-forget UpdateCommand send
    mockSend.mockResolvedValueOnce({});

    const record = await validateApiKey('mx_abcdef1234567890abcdef1234567890');
    expect(record).toEqual({
      userId: 'user-1',
      keyPrefix: 'mx_abc',
      name: 'my-key',
    });
  });

  it('fire-and-forget UpdateCommand for lastUsedAt does not block', async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          userId: 'user-1',
          keyPrefix: 'mx_abc',
          name: 'my-key',
          isActive: true,
        },
      })
      // Make the update slow — it should not block
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 5000)),
      );

    const record = await validateApiKey('mx_abcdef1234567890abcdef1234567890');
    expect(record).toEqual({
      userId: 'user-1',
      keyPrefix: 'mx_abc',
      name: 'my-key',
    });
    // Validate that send was called twice (Get + Update)
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
