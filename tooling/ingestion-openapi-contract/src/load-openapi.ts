import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

export interface OpenApiDocument {
  readonly openapi: string;
  readonly info: { readonly title: string; readonly version: string };
  readonly components: {
    readonly securitySchemes?: Readonly<Record<string, unknown>>;
    readonly schemas?: Readonly<Record<string, unknown>>;
    readonly examples?: Readonly<Record<string, unknown>>;
  };
  readonly paths: Readonly<Record<string, unknown>>;
  readonly security?: unknown;
}

export interface OpenApiSchema {
  readonly type?: unknown;
  readonly enum?: unknown;
  readonly required?: unknown;
  readonly properties?: unknown;
  readonly const?: unknown;
  readonly minItems?: unknown;
  readonly maxItems?: unknown;
  readonly minLength?: unknown;
  readonly maxLength?: unknown;
  readonly minimum?: unknown;
  readonly maximum?: unknown;
  readonly items?: unknown;
  readonly description?: unknown;
  readonly additionalProperties?: unknown;
  readonly [key: string]: unknown;
}

export const INGESTION_OPENAPI_PATH = new URL(
  '../../../docs/api/ingestion.openapi.yaml',
  import.meta.url,
);

export async function loadOpenApiDocument(): Promise<OpenApiDocument> {
  const source = await readFile(INGESTION_OPENAPI_PATH, 'utf8');
  const parsed = parseYaml(source) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('ingestion.openapi.yaml must contain a YAML mapping document');
  }
  return parsed as OpenApiDocument;
}

export function componentSchema(document: OpenApiDocument, name: string): OpenApiSchema {
  const schema = document.components.schemas?.[name];
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new Error(`Missing components.schemas.${name}`);
  }
  return schema as OpenApiSchema;
}

export function schemaEnum(schema: OpenApiSchema): readonly unknown[] {
  if (!Array.isArray(schema.enum)) {
    throw new Error('Schema is missing enum array');
  }
  return schema.enum;
}

export function schemaRequired(schema: OpenApiSchema): readonly string[] {
  if (!Array.isArray(schema.required)) {
    throw new Error('Schema is missing required array');
  }
  return schema.required as readonly string[];
}

export function propertySchema(
  document: OpenApiDocument,
  schemaName: string,
  property: string,
): OpenApiSchema {
  const schema = componentSchema(document, schemaName);
  const properties = schema.properties;
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new Error(`Missing properties for ${schemaName}`);
  }
  const value = (properties as Readonly<Record<string, unknown>>)[property];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Missing ${schemaName}.${property}`);
  }
  return value as OpenApiSchema;
}

export function operationResponses(
  document: OpenApiDocument,
  path: string,
  method: string,
): Readonly<Record<string, unknown>> {
  const operation = document.paths[path] as Readonly<Record<string, unknown>> | undefined;
  if (operation === undefined) {
    throw new Error(`Missing path ${path}`);
  }
  const methodObject = operation[method] as Readonly<Record<string, unknown>> | undefined;
  if (methodObject === undefined) {
    throw new Error(`Missing ${method.toUpperCase()} ${path}`);
  }
  const responseMap = methodObject.responses;
  if (typeof responseMap !== 'object' || responseMap === null || Array.isArray(responseMap)) {
    throw new Error(`Missing responses map for ${method.toUpperCase()} ${path}`);
  }
  return responseMap as Readonly<Record<string, unknown>>;
}
