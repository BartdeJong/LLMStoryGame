// Checks data against the JSON Schema subset used by tools/story-forge/schema/story-pack.schema.json.
// Supported: type, enum, const, required, properties, additionalProperties (boolean or a schema for the values), items,
// minItems, maxItems, minLength, maxLength, pattern, minimum, and local "#/$defs/..." references.

export interface SchemaIssue {
  path: string;
  message: string;
}

type Node = Record<string, unknown>;

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeName(value) === type;
}

export function joinPath(base: string, key: string | number): string {
  if (typeof key === "number") return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

export function checkSchema(data: unknown, root: Node): SchemaIssue[] {
  const issues: SchemaIssue[] = [];

  const resolve = (node: Node): Node => {
    const ref = node.$ref;
    if (typeof ref !== "string") return node;
    const parts = ref.replace(/^#\//, "").split("/");
    let target: unknown = root;
    for (const part of parts) target = (target as Node)[part];
    return target as Node;
  };

  const visit = (value: unknown, rawSchema: Node, path: string): void => {
    const schema = resolve(rawSchema);
    const where = path || "(root)";
    const type = schema.type as string | undefined;
    if (type && !matchesType(value, type)) {
      issues.push({ path: where, message: `expected ${type} but found ${typeName(value)}` });
      return;
    }
    if (schema.const !== undefined && value !== schema.const) {
      issues.push({ path: where, message: `must be ${JSON.stringify(schema.const)} but found ${JSON.stringify(value)}` });
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      issues.push({ path: where, message: `must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")} but found ${JSON.stringify(value)}` });
    }
    if (typeof value === "string") {
      if (typeof schema.minLength === "number" && value.length < schema.minLength) {
        issues.push({ path: where, message: "must not be empty" });
      }
      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
        issues.push({ path: where, message: `has ${value.length} characters but at most ${schema.maxLength} are allowed. Shorten it.` });
      }
      if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
        issues.push({ path: where, message: `"${value}" does not match pattern ${schema.pattern} (lowercase letters, digits and underscores, starting with a letter)` });
      }
    }
    if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
      issues.push({ path: where, message: `must be at least ${schema.minimum} but found ${value}` });
    }
    if (Array.isArray(value)) {
      if (typeof schema.minItems === "number" && value.length < schema.minItems) {
        issues.push({ path: where, message: `needs at least ${schema.minItems} item(s) but has ${value.length}` });
      }
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
        issues.push({ path: where, message: `has ${value.length} item(s) but at most ${schema.maxItems} are allowed` });
      }
      if (schema.items) value.forEach((entry, i) => visit(entry, schema.items as Node, joinPath(path, i)));
    }
    if (type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
      const obj = value as Node;
      const props = (schema.properties ?? {}) as Record<string, Node>;
      for (const key of (schema.required ?? []) as string[]) {
        if (!(key in obj)) issues.push({ path: joinPath(path, key), message: "required field is missing" });
      }
      for (const [key, entry] of Object.entries(obj)) {
        if (props[key]) visit(entry, props[key], joinPath(path, key));
        else if (schema.additionalProperties === false) {
          issues.push({ path: joinPath(path, key), message: "unknown field (not allowed by the schema)" });
        } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
          visit(entry, schema.additionalProperties as Node, joinPath(path, key));
        }
      }
    }
  };

  visit(data, root, "");
  return issues;
}
