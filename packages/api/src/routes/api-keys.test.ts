import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.API_KEYS_TABLE_NAME = 'test-keys-table';

vi.mock('../shared/dynamo.js', () => ({
  ddbDocClient: { send: vi.fn() },
}));

import { listApiKeys, createApiKey, deactivateApiKey, deleteApiKey } from './api-keys.js';
import { ddbDocClient } from '../shared/dynamo.js';

describe('listApiKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with mapped key records', async () => {
    const mockItems = [
      {
        keyHash: 'hash1',
        keyPrefix: 'mx_abcd',
        name: 'Key 1',
        createdAt: '2024-01-01T00:00:00Z',
        lastUsedAt: '2024-01-02T00:00:00Z',
        isActive: true,
      },
      {
        keyHash: 'hash2',
        keyPrefix: 'mx_efgh',
        name: 'Key 2',
        createdAt: '2024-01-03T00:00:00Z',
        lastUsedAt: undefined,
        isActive: false,
      },
    ];

    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({ Items: mockItems } as any);

    const result = await listApiKeys('user-123');
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body).toHaveLength(2);
    expect(body[0].keyHash).toBe('hash1');
    expect(body[0].name).toBe('Key 1');
    expect(body[1].keyHash).toBe('hash2');
  });

  it('returns 200 with empty array when no items', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({ Items: undefined } as any);

    const result = await listApiKeys('user-123');
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body).toEqual([]);
  });
});

describe('createApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 201 with rawKey starting with mx_', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({} as any);

    const result = await createApiKey('user-123', 'Test Key');
    expect(result.statusCode).toBe(201);

    const body = JSON.parse(result.body);
    expect(body.rawKey).toMatch(/^mx_/);
  });

  it('generates key with correct format (mx_ + 64 hex chars)', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({} as any);

    const result = await createApiKey('user-123', 'Test Key');
    const body = JSON.parse(result.body);

    expect(body.rawKey).toHaveLength(67); // 'mx_' (3) + 64 hex chars
    expect(body.rawKey).toMatch(/^mx_[0-9a-f]{64}$/);
  });

  it('writes record to DynamoDB with correct fields', async () => {
    const mockSend = vi.mocked(ddbDocClient.send);
    mockSend.mockResolvedValueOnce({} as any);

    await createApiKey('user-123', 'My Key');

    expect(mockSend).toHaveBeenCalledOnce();
    const putCommand = mockSend.mock.calls[0][0] as any;
    expect(putCommand.input.TableName).toBeDefined();
    expect(putCommand.input.Item.userId).toBe('user-123');
    expect(putCommand.input.Item.name).toBe('My Key');
    expect(putCommand.input.Item.isActive).toBe(true);
    expect(putCommand.input.Item.keyHash).toBeDefined();
    expect(putCommand.input.Item.keyPrefix).toMatch(/^mx_/);
    expect(putCommand.input.Item.createdAt).toBeDefined();
  });
});

describe('deactivateApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when key not found', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({ Item: undefined } as any);

    const result = await deactivateApiKey('user-123', 'nonexistent-hash');
    expect(result.statusCode).toBe(404);

    const body = JSON.parse(result.body);
    expect(body.error).toBe('Key not found');
  });

  it('returns 403 when userId does not match', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({
      Item: { keyHash: 'hash', userId: 'other-user' },
    } as any);

    const result = await deactivateApiKey('user-123', 'hash');
    expect(result.statusCode).toBe(403);

    const body = JSON.parse(result.body);
    expect(body.error).toBe('Forbidden');
  });

  it('returns 200 and updates isActive to false for valid owned key', async () => {
    const mockSend = vi.mocked(ddbDocClient.send);
    // First call: GetCommand (ownership check)
    mockSend.mockResolvedValueOnce({
      Item: { keyHash: 'hash', userId: 'user-123' },
    } as any);
    // Second call: UpdateCommand
    mockSend.mockResolvedValueOnce({} as any);

    const result = await deactivateApiKey('user-123', 'hash');
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);

    // Verify the UpdateCommand was sent
    expect(mockSend).toHaveBeenCalledTimes(2);
    const updateCommand = mockSend.mock.calls[1][0] as any;
    expect(updateCommand.input.UpdateExpression).toContain('isActive');
  });
});

describe('deleteApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when key not found', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({ Item: undefined } as any);

    const result = await deleteApiKey('user-123', 'nonexistent-hash');
    expect(result.statusCode).toBe(404);

    const body = JSON.parse(result.body);
    expect(body.error).toBe('Key not found');
  });

  it('returns 403 when userId does not match', async () => {
    vi.mocked(ddbDocClient.send).mockResolvedValueOnce({
      Item: { keyHash: 'hash', userId: 'other-user' },
    } as any);

    const result = await deleteApiKey('user-123', 'hash');
    expect(result.statusCode).toBe(403);

    const body = JSON.parse(result.body);
    expect(body.error).toBe('Forbidden');
  });

  it('returns 200 and deletes record for valid owned key', async () => {
    const mockSend = vi.mocked(ddbDocClient.send);
    // First call: GetCommand (ownership check)
    mockSend.mockResolvedValueOnce({
      Item: { keyHash: 'hash', userId: 'user-123' },
    } as any);
    // Second call: DeleteCommand
    mockSend.mockResolvedValueOnce({} as any);

    const result = await deleteApiKey('user-123', 'hash');
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);

    // Verify the DeleteCommand was sent
    expect(mockSend).toHaveBeenCalledTimes(2);
    const deleteCommand = mockSend.mock.calls[1][0] as any;
    expect(deleteCommand.input.Key).toEqual({ keyHash: 'hash' });
  });
});
