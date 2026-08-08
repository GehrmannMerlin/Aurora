import type { JsonSchemaObject } from '../common/schema.js';
import { PLATFORM_OPERATIONS, type OperationDef } from '../registry/operations.js';
import { toJsonSchema, type SchemaRegistry } from './to-json-schema.js';

export interface OpenApiDocument {
  readonly openapi: string;
  readonly info: { readonly title: string; readonly version: string };
  readonly servers: readonly { readonly url: string }[];
  readonly paths: Readonly<Record<string, unknown>>;
  readonly components: { readonly schemas: Readonly<Record<string, unknown>> };
  readonly tags: readonly { readonly name: string }[];
}

const API_PREFIX = '/api/platform/v1';

function createRegistry(): SchemaRegistry {
  const names = new Map<string, JsonSchemaObject>();
  return {
    register: (name, schema) => {
      if (!names.has(name)) names.set(name, schema);
    },
    read: () => Object.fromEntries(names),
  };
}

function buildPathKey(op: OperationDef): string {
  return op.path.startsWith(API_PREFIX) ? op.path.slice(API_PREFIX.length) : op.path;
}

export function generateOpenApiDocument(opts: { title?: string } = {}): OpenApiDocument {
  const registry = createRegistry();
  const paths: Record<string, unknown> = {};
  const tags = new Set<string>();

  for (const op of PLATFORM_OPERATIONS) {
    for (const t of op.tags) tags.add(t);
    const responses: Record<string, unknown> = {};
    for (const [status, schema] of Object.entries(op.responses)) {
      const name =
        status === '200' ? `${op.operationId}Response` : `${op.operationId}${status}Response`;
      responses[status] = {
        description: `${status} response`,
        content: { 'application/json': { schema: toJsonSchema(schema, registry, name) } },
      };
    }
    const operation: Record<string, unknown> = {
      operationId: op.operationId,
      summary: op.summary,
      tags: op.tags,
      responses,
    };
    if (op.request?.query)
      operation.parameters = [
        { name: 'query', in: 'query', schema: toJsonSchema(op.request.query, registry) },
      ];
    if (op.request?.body)
      operation.requestBody = {
        content: { 'application/json': { schema: toJsonSchema(op.request.body, registry) } },
      };
    const key = buildPathKey(op);
    const existing = (paths[key] as Record<string, unknown> | undefined) ?? {};
    existing[op.method.toLowerCase()] = operation;
    paths[key] = existing;
  }

  return {
    openapi: '3.1.0',
    info: { title: opts.title ?? 'Aurora Platform API', version: 'v1' },
    servers: [{ url: API_PREFIX }],
    paths,
    components: { schemas: registry.read() },
    tags: [...tags].sort().map((name) => ({ name })),
  };
}
