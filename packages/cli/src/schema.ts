import { z } from 'zod';

export interface JsonSchemaProp {
  type?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  items?: { type?: string };
}

/**
 * Convert a JSON Schema property definition to a Zod schema.
 * Uses z.coerce for numbers to handle string-to-number coercion
 * (MCP clients often send numbers as strings).
 */
export function jsonSchemaToZod(prop: JsonSchemaProp, isRequired: boolean): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (prop.type) {
    case 'number':
    case 'integer': {
      let num: z.ZodTypeAny = z.coerce.number();
      if (prop.minimum !== undefined) num = (num as z.ZodNumber).min(prop.minimum);
      if (prop.maximum !== undefined) num = (num as z.ZodNumber).max(prop.maximum);
      schema = num;
      break;
    }
    case 'boolean':
      schema = z.boolean();
      break;
    case 'array':
      schema = z.array(
        prop.items?.type === 'number' ? z.coerce.number() : z.string(),
      );
      break;
    default:
      schema = z.string();
      break;
  }

  if (prop.description) {
    schema = schema.describe(prop.description);
  }
  if (prop.default !== undefined) {
    schema = schema.optional().default(prop.default);
  } else if (!isRequired) {
    schema = schema.optional();
  }

  return schema;
}

/**
 * Build a Zod raw shape from the remote tool's properties.
 * The remote may return properties in inputSchema.properties or in annotations.
 * Respects the JSON Schema `required` array to mark fields as optional.
 */
export function buildZodShape(tool: {
  inputSchema?: {
    properties?: Record<string, JsonSchemaProp>;
    required?: string[];
  };
  annotations?: Record<string, unknown>;
}): Record<string, z.ZodTypeAny> {
  // Prefer inputSchema.properties; fall back to annotations if properties is empty
  const props = tool.inputSchema?.properties;
  const source = props && Object.keys(props).length > 0
    ? props
    : (tool.annotations as Record<string, JsonSchemaProp> | undefined) ?? {};

  const requiredFields = new Set(tool.inputSchema?.required ?? []);

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, def] of Object.entries(source)) {
    if (typeof def === 'object' && def !== null && 'type' in def) {
      shape[key] = jsonSchemaToZod(def, requiredFields.has(key));
    }
  }
  return shape;
}
