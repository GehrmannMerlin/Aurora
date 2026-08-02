import type { OpenApiSchema } from './load-openapi.js';

export interface SchemaDrift {
  readonly message: string;
}

function expectEqual(actual: unknown, expected: unknown, label: string): readonly SchemaDrift[] {
  if (actual === expected) return [];
  return [{ message: `${label}: expected ${String(expected)}, got ${String(actual)}` }];
}

function expectSetEqual(
  actual: readonly unknown[],
  expected: readonly unknown[],
  label: string,
): readonly SchemaDrift[] {
  const actualSet = new Set(actual.map(String));
  const expectedSet = new Set(expected.map(String));
  const missing = [...expectedSet].filter((value) => !actualSet.has(value));
  const extra = [...actualSet].filter((value) => !expectedSet.has(value));
  const drifts: SchemaDrift[] = [];
  if (missing.length > 0) {
    drifts.push({ message: `${label}: missing enum values: ${missing.join(', ')}` });
  }
  if (extra.length > 0) {
    drifts.push({ message: `${label}: extra enum values: ${extra.join(', ')}` });
  }
  return drifts;
}

export function assertEnumMatches(
  schema: OpenApiSchema,
  expected: readonly unknown[],
  label: string,
): readonly SchemaDrift[] {
  if (!Array.isArray(schema.enum)) {
    return [{ message: `${label}: schema has no enum array` }];
  }
  return expectSetEqual(schema.enum, expected, `${label}.enum`);
}

export function assertRequiredFields(
  schema: OpenApiSchema,
  expected: readonly string[],
  label: string,
): readonly SchemaDrift[] {
  if (!Array.isArray(schema.required)) {
    return [{ message: `${label}: schema has no required array` }];
  }
  const required = schema.required as readonly string[];
  const missing = expected.filter((field) => !required.includes(field));
  const extra = required.filter((field) => !expected.includes(field));
  const drifts: SchemaDrift[] = [];
  if (missing.length > 0) {
    drifts.push({ message: `${label}: missing required fields: ${missing.join(', ')}` });
  }
  if (extra.length > 0) {
    drifts.push({ message: `${label}: unexpected required fields: ${extra.join(', ')}` });
  }
  return drifts;
}

export function assertNumberLimit(
  schema: OpenApiSchema,
  key: 'minItems' | 'maxItems' | 'minLength' | 'maxLength' | 'minimum' | 'maximum',
  expected: number,
  label: string,
): readonly SchemaDrift[] {
  return expectEqual(schema[key], expected, `${label}.${key}`);
}

export function assertConst(
  schema: OpenApiSchema,
  expected: unknown,
  label: string,
): readonly SchemaDrift[] {
  return expectEqual(schema.const, expected, `${label}.const`);
}

export function assertType(
  schema: OpenApiSchema,
  expected: string,
  label: string,
): readonly SchemaDrift[] {
  return expectEqual(schema.type, expected, `${label}.type`);
}

export function collectDrifts(...groups: readonly (readonly SchemaDrift[])[]): void {
  const drifts = groups.flat();
  if (drifts.length === 0) return;
  const lines = drifts.map((drift) => `- ${drift.message}`).join('\n');
  throw new Error(`OpenAPI drift detected:\n${lines}`);
}
