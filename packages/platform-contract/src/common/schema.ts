import { z } from 'zod';

export interface JsonSchemaObject {
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly properties?: Readonly<Record<string, JsonSchemaObject>>;
  readonly items?: JsonSchemaObject;
  readonly additionalProperties?: boolean | JsonSchemaObject;
  readonly required?: readonly string[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly anyOf?: readonly JsonSchemaObject[];
  readonly format?: string;
  readonly nullable?: boolean;
  readonly description?: string;
  readonly [key: string]: unknown;
}

export interface SchemaMeta {
  readonly openEnum?: boolean;
  readonly defaultSort?: readonly string[];
  readonly nullSemantics?: 'absent' | 'empty' | 'unknown';
}

export interface SchemaDef {
  readonly zod: z.ZodType;
  readonly openapi: JsonSchemaObject;
  readonly meta: SchemaMeta;
}

function def(zod: z.ZodType, openapi: JsonSchemaObject, meta: SchemaMeta = {}): SchemaDef {
  return { zod, openapi, meta };
}

export function str(minLength = 1, maxLength = 1024): SchemaDef {
  return def(z.string().min(minLength).max(maxLength), {
    type: 'string',
    minLength,
    maxLength,
  });
}

export function num(minimum?: number, maximum?: number): SchemaDef {
  const base = minimum === undefined ? z.number() : z.number().min(minimum);
  const refined = maximum === undefined ? base : base.max(maximum);
  return def(refined, {
    type: 'number',
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  });
}

export function bool(): SchemaDef {
  return def(z.boolean(), { type: 'boolean' });
}

export function enum_(values: readonly string[], opts: { openEnum?: boolean } = {}): SchemaDef {
  const zod = z.enum(values as [string, ...string[]]);
  const meta: SchemaMeta = opts.openEnum === undefined ? {} : { openEnum: opts.openEnum };
  return def(zod, { type: 'string', enum: values }, meta);
}

export function obj(props: Readonly<Record<string, SchemaDef>>, requiredAll = true): SchemaDef {
  const entries = Object.entries(props);
  const shape = Object.fromEntries(entries.map(([k, v]) => [k, v.zod]));
  // Contract objects are closed: unknown keys are rejected (zod) and forbidden (JSON Schema).
  // Open maps are expressed with rec(), which carries its own additionalProperties schema.
  const base = requiredAll ? z.object(shape) : z.object(shape).partial();
  const zod = base.strict();
  const required = requiredAll
    ? entries.filter(([, v]) => !v.zod.safeParse(undefined).success).map(([k]) => k)
    : [];
  return def(zod, {
    type: 'object',
    properties: Object.fromEntries(entries.map(([k, v]) => [k, v.openapi])),
    additionalProperties: false,
    ...(required.length > 0 ? { required } : {}),
  });
}

export function arr(item: SchemaDef, min = 0, max = 100): SchemaDef {
  return def(z.array(item.zod).min(min).max(max), { type: 'array', items: item.openapi });
}

export function rec(value: SchemaDef): SchemaDef {
  return def(z.record(z.string(), value.zod), {
    type: 'object',
    additionalProperties: value.openapi,
  });
}

export function union(members: readonly SchemaDef[]): SchemaDef {
  return def(z.union(members.map((m) => m.zod) as [z.ZodType, z.ZodType, ...z.ZodType[]]), {
    anyOf: members.map((m) => m.openapi),
  });
}

export function nullable(def_: SchemaDef): SchemaDef {
  // OpenAPI 3.1 (JSON Schema 2020-12) has no `nullable` keyword: a nullable value is a
  // two-member type union [T, 'null']. Drop the draft-04 `nullable` key and widen `type`;
  // every other key (properties/items/enum/format/minLength/maxLength/etc.) is unchanged.
  const { type, ...rest } = def_.openapi;
  const openapi = Object.fromEntries(
    Object.entries(rest).filter(([key]) => key !== 'nullable'),
  ) as JsonSchemaObject;
  const nullableType = widenNullableType(type);
  return def(z.nullable(def_.zod), {
    ...openapi,
    ...(nullableType === undefined ? {} : { type: nullableType }),
  });
}

function widenNullableType(
  type: string | readonly string[] | undefined,
): string | readonly string[] | undefined {
  if (typeof type === 'string') return [type, 'null'];
  if (type === undefined) return undefined;
  return type.includes('null') ? type : [...type, 'null'];
}

export function optional(def_: SchemaDef): SchemaDef {
  return def(z.optional(def_.zod), def_.openapi);
}

// T is the brand name, supplied by callers (e.g. brandedId<'AccountId'>('AccountId')). It is used
// only in the body via .brand<T>() because SchemaDef.zod is typed as the erasing z.ZodType base.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function brandedId<T extends string>(name: string, min = 3, max = 64): SchemaDef {
  return def(z.string().min(min).max(max).brand<T>(), {
    type: 'string',
    minLength: min,
    maxLength: max,
    description: name,
  });
}
