import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { jsonSchemaToZod, buildZodShape, type JsonSchemaProp } from './schema.js';

describe('jsonSchemaToZod', () => {
  describe('optional vs required', () => {
    it('marks non-required fields as optional', () => {
      const schema = jsonSchemaToZod({ type: 'number' }, false);
      const result = z.object({ val: schema }).safeParse({});
      expect(result.success).toBe(true);
    });

    it('marks required fields as required', () => {
      const schema = jsonSchemaToZod({ type: 'string' }, true);
      const result = z.object({ val: schema }).safeParse({});
      expect(result.success).toBe(false);
    });

    it('fields with defaults are always optional', () => {
      const schema = jsonSchemaToZod({ type: 'number', default: 10 }, true);
      const result = z.object({ val: schema }).safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.val).toBe(10);
      }
    });
  });

  describe('number coercion', () => {
    it('coerces string to number', () => {
      const schema = jsonSchemaToZod({ type: 'number' }, true);
      const result = z.object({ val: schema }).safeParse({ val: '25' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.val).toBe(25);
      }
    });

    it('coerces string to integer', () => {
      const schema = jsonSchemaToZod({ type: 'integer' }, true);
      const result = z.object({ val: schema }).safeParse({ val: '10' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.val).toBe(10);
      }
    });

    it('respects min/max constraints', () => {
      const schema = jsonSchemaToZod(
        { type: 'number', minimum: 1, maximum: 25 },
        true,
      );
      expect(z.object({ val: schema }).safeParse({ val: 0 }).success).toBe(false);
      expect(z.object({ val: schema }).safeParse({ val: 26 }).success).toBe(false);
      expect(z.object({ val: schema }).safeParse({ val: 10 }).success).toBe(true);
    });
  });

  describe('array type', () => {
    it('accepts string arrays', () => {
      const schema = jsonSchemaToZod(
        { type: 'array', items: { type: 'string' } },
        true,
      );
      const result = z.object({ val: schema }).safeParse({ val: ['a', 'b'] });
      expect(result.success).toBe(true);
    });

    it('optional array accepts undefined', () => {
      const schema = jsonSchemaToZod(
        { type: 'array', items: { type: 'string' } },
        false,
      );
      const result = z.object({ val: schema }).safeParse({});
      expect(result.success).toBe(true);
    });
  });
});

describe('buildZodShape', () => {
  it('marks fields in required array as required', () => {
    const tool = {
      inputSchema: {
        properties: {
          playlistId: { type: 'string' },
          trackIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['playlistId', 'trackIds'],
      },
    };
    const shape = buildZodShape(tool);
    const schema = z.object(shape);

    // Missing both required fields
    expect(schema.safeParse({}).success).toBe(false);
    // Missing trackIds
    expect(schema.safeParse({ playlistId: 'p.123' }).success).toBe(false);
    // All present
    expect(
      schema.safeParse({ playlistId: 'p.123', trackIds: ['1'] }).success,
    ).toBe(true);
  });

  it('marks fields NOT in required array as optional', () => {
    const tool = {
      inputSchema: {
        properties: {
          limit: { type: 'number' } as JsonSchemaProp,
          offset: { type: 'number' } as JsonSchemaProp,
        },
        required: [] as string[],
      },
    };
    const shape = buildZodShape(tool);
    const schema = z.object(shape);

    // Both omitted — should pass
    expect(schema.safeParse({}).success).toBe(true);
  });

  it('handles mix of required and optional fields', () => {
    const tool = {
      inputSchema: {
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          trackIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['name'],
      },
    };
    const shape = buildZodShape(tool);
    const schema = z.object(shape);

    // Only name (required) — should pass
    expect(schema.safeParse({ name: 'My Playlist' }).success).toBe(true);
    // Missing name — should fail
    expect(schema.safeParse({ description: 'desc' }).success).toBe(false);
  });

  it('treats all fields as optional when required array is absent', () => {
    const tool = {
      inputSchema: {
        properties: {
          limit: { type: 'number' },
          offset: { type: 'number' },
        },
      },
    };
    const shape = buildZodShape(tool);
    const schema = z.object(shape);

    expect(schema.safeParse({}).success).toBe(true);
  });

  it('coerces number strings in built shape', () => {
    const tool = {
      inputSchema: {
        properties: {
          limit: { type: 'number' },
        },
        required: ['limit'],
      },
    };
    const shape = buildZodShape(tool);
    const schema = z.object(shape);
    const result = schema.safeParse({ limit: '25' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });
});
