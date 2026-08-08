import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { generateOpenApiDocument } from '../src/generator/openapi.js';
import { OPERATION_MANIFEST } from '../src/registry/manifest.js';
import { CONTRACT_CAPABILITIES } from '../src/registry/capabilities.js';
import { PLATFORM_OPERATIONS, type OperationDef } from '../src/registry/operations.js';
import type { JsonSchemaObject } from '../src/common/schema.js';

const apiDirUrl = new URL('../../../docs/api/', import.meta.url);
const apiDir = fileURLToPath(apiDirUrl);
const GENERATED_HEADER = '# 由契约源码生成、禁止手工修改\n';

// ---------------------------------------------------------------------------
// Compatibility baseline (spec §30 / ADR-027 决定细节 6). MUST stay byte-identical to the copy in
// tooling/platform-contract-drift/src/compat.ts: the drift gate regenerates this baseline from
// PLATFORM_OPERATIONS and compares it to the committed artifact written here. Divergence is caught
// by the drift gate's "regenerates the committed baseline identically" test.
// ---------------------------------------------------------------------------

interface CompatibilityBaseline {
  readonly version: 'v1';
  readonly generatedBy: 'packages/platform-contract/scripts/generate-openapi.ts';
  readonly operations: Readonly<Record<string, OperationCompatibilityBaseline>>;
}

interface OperationCompatibilityBaseline {
  readonly responses: Readonly<Record<string, SchemaCompatibilityNode>>;
}

interface SchemaCompatibilityNode {
  readonly type?: string | readonly string[];
  readonly format?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: readonly string[];
  readonly openEnum?: boolean;
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, SchemaCompatibilityNode>>;
  readonly items?: SchemaCompatibilityNode;
  readonly anyOf?: readonly SchemaCompatibilityNode[];
  readonly additionalProperties?: SchemaCompatibilityNode;
  readonly defaultSort?: readonly string[];
  readonly nullSemantics?: 'absent' | 'empty' | 'unknown';
}

// Mutable build type for projectSchema: homomorphic mapped type keeps optionality, drops readonly.
type MutableSchemaNode = {
  -readonly [K in keyof SchemaCompatibilityNode]: SchemaCompatibilityNode[K];
};

function buildCompatibilityBaseline(operations: readonly OperationDef[]): CompatibilityBaseline {
  const operationBaselines: Record<string, OperationCompatibilityBaseline> = {};
  for (const op of operations) {
    const responses: Record<string, SchemaCompatibilityNode> = {};
    for (const [status, schema] of Object.entries(op.responses)) {
      responses[status] = projectSchema(schema.openapi);
    }
    operationBaselines[op.operationId] = { responses };
  }
  return {
    version: 'v1',
    generatedBy: 'packages/platform-contract/scripts/generate-openapi.ts',
    operations: operationBaselines,
  };
}

function projectSchema(schema: JsonSchemaObject): SchemaCompatibilityNode {
  const node: MutableSchemaNode = {};
  if (schema.type !== undefined) node.type = schema.type;
  if (schema.format !== undefined) node.format = schema.format;
  if (schema.minLength !== undefined) node.minLength = schema.minLength;
  if (schema.maxLength !== undefined) node.maxLength = schema.maxLength;
  if (schema.minimum !== undefined) node.minimum = schema.minimum;
  if (schema.maximum !== undefined) node.maximum = schema.maximum;
  if (schema.enum !== undefined) {
    node.enum = schema.enum as readonly string[];
    // The generator does not thread SchemaDef.meta.openEnum into the emitted OpenAPI document, so
    // closed-vs-open status is not observable from the schema tree. Per §30 / ADR-027 决定细节 6 the
    // rule is "closed unless explicitly marked open". No enum in the current contract is
    // explicitly open (`routeTargetId` is declared openEnum: false), so every projected enum is
    // closed. If a future contract marks an enum open, thread SchemaDef.meta into this projection.
    node.openEnum = false;
  }
  if (schema.required !== undefined) node.required = schema.required;
  if (schema.properties !== undefined) {
    const properties: Record<string, SchemaCompatibilityNode> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      properties[key] = projectSchema(value);
    }
    node.properties = properties;
  }
  if (schema.items !== undefined) node.items = projectSchema(schema.items);
  if (schema.anyOf !== undefined) node.anyOf = schema.anyOf.map((member) => projectSchema(member));
  if (typeof schema.additionalProperties === 'object') {
    node.additionalProperties = projectSchema(schema.additionalProperties);
  }
  return node;
}

async function main(): Promise<void> {
  await mkdir(apiDir, { recursive: true });
  const yaml =
    GENERATED_HEADER + stringify(generateOpenApiDocument({ title: 'Aurora Platform API' }));
  await writeFile(new URL('platform-openapi-v1.yaml', apiDirUrl), yaml, 'utf8');
  const manifest =
    JSON.stringify(
      {
        ...OPERATION_MANIFEST,
        capabilities: CONTRACT_CAPABILITIES,
        compatibilityBaseline: buildCompatibilityBaseline(PLATFORM_OPERATIONS),
      },
      null,
      2,
    ) + '\n';
  await writeFile(new URL('platform-openapi-v1.manifest.json', apiDirUrl), manifest, 'utf8');
}

await main();
