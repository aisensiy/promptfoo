import { type ZodType, z } from 'zod';
import { UnifiedConfigSchema } from '../src/types';
import { StringOrFunctionSchema } from '../src/validators/shared';

// NOTE: This script accesses Zod's internal _def property to extract the input schema
// from pipe/transform wrappers. This is necessary because UnifiedConfigSchema uses
// .pipe() for transforms, and we need the input schema for JSON Schema generation.
// This may need updating if Zod's internal structure changes.

// UnifiedConfigSchema is wrapped in a .pipe() transform, so we need to extract
// the inner schema to generate JSON schema properly
function getInnerSchema(schema: ZodType): ZodType {
  const def = schema._def as { in?: ZodType };
  if (def?.in) {
    return def.in;
  }
  return schema;
}

// Recursively unwrap to get the base schema (unwrapping optional, nullable, pipe, transform)
function getBaseSchema(schema: ZodType): ZodType {
  const def = schema._def as { type?: string; in?: ZodType; innerType?: ZodType };

  if (def?.type === 'optional' && def?.innerType) {
    return getBaseSchema(def.innerType);
  }
  if (def?.type === 'nullable' && def?.innerType) {
    return getBaseSchema(def.innerType);
  }
  if (def?.type === 'pipe' && def?.in) {
    return getBaseSchema(def.in);
  }
  if (def?.type === 'transform' && def?.in) {
    return getBaseSchema(def.in);
  }

  return schema;
}

const innerSchema = getInnerSchema(UnifiedConfigSchema);

const transformSchemaKeys = new Set([
  'contextTransform',
  'postprocess',
  'transform',
  'transformVars',
]);

function forceStringTransformSchemas(node: unknown): void {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      forceStringTransformSchemas(item);
    }
    return;
  }

  const schemaObject = node as Record<string, unknown>;

  for (const [key, value] of Object.entries(schemaObject)) {
    if (
      transformSchemaKeys.has(key) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      const description = (value as Record<string, unknown>).description;

      for (const schemaKey of Object.keys(value)) {
        delete (value as Record<string, unknown>)[schemaKey];
      }

      Object.assign(value as Record<string, unknown>, {
        ...(typeof description === 'string' ? { description } : {}),
        type: 'string',
      });
    }

    forceStringTransformSchemas(value);
  }
}

// Options for nested toJSONSchema calls (without reused:'ref' to avoid orphaned definitions)
const nestedOptions = {
  target: 'draft-07' as const,
  unrepresentable: 'any' as const,
};

// Generate JSON Schema using Zod v4's native toJSONSchema
// - target: 'draft-07' for compatibility with most tooling
// - unrepresentable: 'any' converts z.custom() functions to {} (accepts any)
// - reused: 'ref' extracts duplicate schemas to definitions, reducing size significantly
// - override: handles nested pipe/transform schemas that Zod doesn't convert automatically
const schemaContent = z.toJSONSchema(innerSchema, {
  ...nestedOptions,
  reused: 'ref' as const,
  // biome-ignore lint/suspicious/noExplicitAny: Zod v4 internal types are not publicly exported
  override: (ctx: any) => {
    const zodSchema = ctx.zodSchema as ZodType;
    const def = zodSchema._def as { type?: string; in?: ZodType; innerType?: ZodType };
    const baseSchema = getBaseSchema(zodSchema);

    // Config files can only represent string transforms. Preserve runtime support for function
    // transforms in the Zod schema, but keep generated JSON Schema string-only for editor/Ajv use.
    if (baseSchema === StringOrFunctionSchema) {
      for (const key of Object.keys(ctx.jsonSchema)) {
        delete ctx.jsonSchema[key];
      }
      Object.assign(ctx.jsonSchema, { type: 'string' });
      return;
    }

    // Handle optional/nullable wrapping a pipe/transform
    if ((def?.type === 'optional' || def?.type === 'nullable') && def?.innerType) {
      const innerDef = def.innerType._def as { type?: string };
      if (innerDef?.type === 'pipe' || innerDef?.type === 'transform') {
        if (Object.keys(ctx.jsonSchema).length === 0) {
          const result = z.toJSONSchema(baseSchema, nestedOptions);
          const { $schema: _, ...rest } = result as Record<string, unknown>;
          Object.assign(ctx.jsonSchema, rest);
        }
      }
    }

    // Handle pipe/transform directly
    if ((def?.type === 'pipe' || def?.type === 'transform') && def?.in) {
      if (Object.keys(ctx.jsonSchema).length === 0) {
        const result = z.toJSONSchema(baseSchema, nestedOptions);
        const { $schema: _, ...rest } = result as Record<string, unknown>;
        Object.assign(ctx.jsonSchema, rest);
      }
    }
  },
});

// Extract the main schema parts
const {
  $schema: _,
  definitions: zodDefinitions,
  ...mainSchema
} = schemaContent as Record<string, unknown>;

// Build final schema with proper structure and metadata
const jsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://promptfoo.dev/config-schema.json',
  title: 'Promptfoo Configuration Schema',
  $ref: '#/definitions/PromptfooConfigSchema',
  definitions: {
    PromptfooConfigSchema: mainSchema,
    ...(zodDefinitions as Record<string, unknown>),
  },
};

// Zod may rewrite reused StringOrFunctionSchema nodes after `override` runs. Do a final pass to keep
// transform-like fields string-only in JSON Schema while runtime Zod still accepts functions.
forceStringTransformSchemas(jsonSchema);

console.log(JSON.stringify(jsonSchema, null, 2));
