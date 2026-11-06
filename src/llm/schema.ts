// Small schema validator. Every node carries a safe fallback, so invalid fields
// can be replaced one by one instead of failing the whole result.

export type Schema =
  | { kind: "string"; fallback: string; maxLength?: number; oneOf?: readonly string[] }
  | { kind: "number"; fallback: number; min?: number; max?: number; integer?: boolean }
  | { kind: "boolean"; fallback: boolean }
  | { kind: "array"; items: Schema; minItems?: number; maxItems?: number; fallback?: unknown[] }
  | { kind: "object"; props: Record<string, Schema> }
  | { kind: "nullable"; inner: Schema };

export type TypedSchema<T> = Schema & { readonly __type?: T };

export interface ValidationResult {
  value: unknown;
  issues: string[];
}

export const s = {
  string: (fallback: string, options: { maxLength?: number; oneOf?: readonly string[] } = {}): Schema => ({
    kind: "string",
    fallback,
    ...options,
  }),
  number: (fallback: number, options: { min?: number; max?: number; integer?: boolean } = {}): Schema => ({
    kind: "number",
    fallback,
    ...options,
  }),
  boolean: (fallback: boolean): Schema => ({ kind: "boolean", fallback }),
  array: (items: Schema, options: { minItems?: number; maxItems?: number; fallback?: unknown[] } = {}): Schema => ({
    kind: "array",
    items,
    ...options,
  }),
  object: (props: Record<string, Schema>): Schema => ({ kind: "object", props }),
  nullable: (inner: Schema): Schema => ({ kind: "nullable", inner }),
};

export function defineSchema<T>(schema: Schema): TypedSchema<T> {
  return schema;
}

export function defaultValue(schema: Schema): unknown {
  switch (schema.kind) {
    case "string":
    case "number":
    case "boolean":
      return schema.fallback;
    case "array":
      return schema.fallback ? [...schema.fallback] : [];
    case "nullable":
      return null;
    case "object":
      return Object.fromEntries(Object.entries(schema.props).map(([key, child]) => [key, defaultValue(child)]));
  }
}

export function validate(schema: Schema, input: unknown, path = "$"): ValidationResult {
  const issues: string[] = [];
  const value = check(schema, input, path, issues);
  return { value, issues };
}

function check(schema: Schema, input: unknown, path: string, issues: string[]): unknown {
  switch (schema.kind) {
    case "string": {
      if (typeof input !== "string" || input.trim() === "") return fail(schema, path, "expected a non-empty string", issues);
      const text = input.trim();
      if (schema.oneOf && !schema.oneOf.includes(text)) {
        return fail(schema, path, `expected one of ${schema.oneOf.join("|")}`, issues);
      }
      return schema.maxLength !== undefined && text.length > schema.maxLength ? text.slice(0, schema.maxLength) : text;
    }
    case "number": {
      if (typeof input !== "number" || !Number.isFinite(input)) return fail(schema, path, "expected a number", issues);
      if (schema.integer && !Number.isInteger(input)) return fail(schema, path, "expected an integer", issues);
      if ((schema.min !== undefined && input < schema.min) || (schema.max !== undefined && input > schema.max)) {
        return fail(schema, path, `expected ${schema.min ?? "-inf"}..${schema.max ?? "inf"}`, issues);
      }
      return input;
    }
    case "boolean":
      return typeof input === "boolean" ? input : fail(schema, path, "expected a boolean", issues);
    case "nullable":
      return input === null ? null : check(schema.inner, input, path, issues);
    case "array": {
      if (!Array.isArray(input)) return fail(schema, path, "expected an array", issues);
      const items: unknown[] = [];
      input.forEach((item, index) => {
        if (schema.maxItems !== undefined && items.length >= schema.maxItems) return;
        const itemIssues: string[] = [];
        const checked = check(schema.items, item, `${path}[${index}]`, itemIssues);
        if (itemIssues.length === 0) {
          items.push(checked);
        } else {
          // A broken list entry is dropped, not patched; it still counts as an issue.
          issues.push(...itemIssues);
        }
      });
      if (schema.minItems !== undefined && items.length < schema.minItems) {
        return fail(schema, path, `expected at least ${schema.minItems} items`, issues);
      }
      return items;
    }
    case "object": {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return fail(schema, path, "expected an object", issues);
      }
      const record = input as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.props)) {
        result[key] = key in record ? check(child, record[key], `${path}.${key}`, issues) : fail(child, `${path}.${key}`, "missing", issues);
      }
      return result;
    }
  }
}

function fail(schema: Schema, path: string, message: string, issues: string[]): unknown {
  issues.push(`${path}: ${message}`);
  return defaultValue(schema);
}

// JSON Schema for runtimes that support guided decoding. All keys are required.
export function toJsonSchema(schema: Schema): Record<string, unknown> {
  switch (schema.kind) {
    case "string":
      return schema.oneOf ? { type: "string", enum: [...schema.oneOf] } : { type: "string" };
    case "number":
      return { type: schema.integer ? "integer" : "number" };
    case "boolean":
      return { type: "boolean" };
    case "nullable":
      return { anyOf: [toJsonSchema(schema.inner), { type: "null" }] };
    case "array":
      return { type: "array", items: toJsonSchema(schema.items) };
    case "object":
      return {
        type: "object",
        properties: Object.fromEntries(Object.entries(schema.props).map(([key, child]) => [key, toJsonSchema(child)])),
        required: Object.keys(schema.props),
        additionalProperties: false,
      };
  }
}
