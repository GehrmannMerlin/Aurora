import type { JsonSchemaObject, OperationDef } from '@aurora/platform-contract';

// Schema-level compatibility gate for the same-major-version platform contract.
//
// Spec: docs/architecture/platform-contract-foundation.md §30 (compatibility), §35, §37.12.
// ADR:  docs/adr/ADR-027-platform-contract-codegen-tooling.md 决定细节 6.
//
// The gate is fail-closed: any change that does not clearly fit a compatible class is reported so
// a human must review it. Pure additions (new operation, new optional field, new optional value on
// an explicitly-open enum) are the only silent-compatible changes; every incompatible class from
// §30 is machine-detected from the baseline shape where it is observable (see the per-class notes
// in detectIncompatibleChanges). Semantic-meaning changes (permission/meaning/idempotency/
// concurrency/cache/error-recovery semantics) are NOT observable from the schema surface alone and
// are deferred to the parallel human-review gate required by ADR-027 决定细节 6 — the machine gate
// reports them only when they are expressed as schema/type/bound/metadata changes.
//
// Baseline shape: a deterministic projection of the emitted OpenAPI schema tree for every stable
// operation's responses. It intentionally drops cosmetic keys (description, titles) so cosmetic
// edits never trip the gate, and keeps only the keys the compat classes read.

export interface CompatibilityBaseline {
  readonly version: 'v1';
  readonly generatedBy: 'packages/platform-contract/scripts/generate-openapi.ts';
  readonly operations: Readonly<Record<string, OperationCompatibilityBaseline>>;
}

export interface OperationCompatibilityBaseline {
  readonly responses: Readonly<Record<string, SchemaCompatibilityNode>>;
}

export interface SchemaCompatibilityNode {
  readonly type?: string | readonly string[];
  readonly format?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  // Present iff this node is an enum. openEnum marks the enum explicitly open (true) or closed
  // (false/absent). Only an explicitly-open enum may gain values within a major version.
  readonly enum?: readonly string[];
  readonly openEnum?: boolean;
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, SchemaCompatibilityNode>>;
  readonly items?: SchemaCompatibilityNode;
  readonly anyOf?: readonly SchemaCompatibilityNode[];
  readonly additionalProperties?: SchemaCompatibilityNode;
  // Metadata markers declared by SchemaMeta (defaultSort / nullSemantics) are not threaded into
  // the emitted OpenAPI document, so they are not observable here today. detectIncompatibleChanges
  // still supports them so that a future baseline that records them is compared correctly.
  readonly defaultSort?: readonly string[];
  readonly nullSemantics?: 'absent' | 'empty' | 'unknown';
}

// MUST stay byte-identical to the copy in packages/platform-contract/scripts/generate-openapi.ts:
// both walk the same PLATFORM_OPERATIONS schema tree and must produce the same committed baseline.
// Divergence is caught by the drift integration test (assertPlatformDrift regenerates and compares
// to the committed artifact).
export function buildCompatibilityBaseline(
  operations: readonly OperationDef[],
): CompatibilityBaseline {
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

// Mutable build type for projectSchema: homomorphic mapped type keeps optionality, drops readonly.
type MutableSchemaNode = {
  -readonly [K in keyof SchemaCompatibilityNode]: SchemaCompatibilityNode[K];
};

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
    // rule is "closed unless explicitly marked open": a YAML `enum:` list that is not marked open
    // is closed. No enum in the current contract is explicitly open (`routeTargetId` is declared
    // openEnum: false), so every projected enum is closed. If a future contract marks an enum
    // open, thread SchemaDef.meta into this projection.
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

// Compares two baselines and returns a list of incompatibility descriptions, or [] when the change
// from prev to next is compatible. prev is the older/committed baseline, next the newer/current.
export function detectIncompatibleChanges(
  prev: CompatibilityBaseline,
  next: CompatibilityBaseline,
): string[] {
  const findings: string[] = [];
  for (const opId of Object.keys(prev.operations)) {
    const prevOp = prev.operations[opId];
    const nextOp = next.operations[opId];
    if (prevOp === undefined) continue;
    if (nextOp === undefined) {
      // Removed operation: incompatible (a rename surfaces here as remove + add).
      findings.push(`removed operation ${opId}`);
      continue;
    }
    for (const status of Object.keys(prevOp.responses)) {
      const prevResponse = prevOp.responses[status];
      const nextResponse = nextOp.responses[status];
      if (prevResponse === undefined) continue;
      if (nextResponse === undefined) {
        findings.push(`removed ${status} response for ${opId}`);
        continue;
      }
      compareNode(prevResponse, nextResponse, `${opId} ${status} response`, findings);
    }
  }
  // New operations are pure additions and are compatible (not reported).
  return findings;
}

function compareNode(
  prevNode: SchemaCompatibilityNode,
  nextNode: SchemaCompatibilityNode,
  path: string,
  findings: string[],
): void {
  // Type change: string→number, object→array, etc. A pure widening of the `type:` list to include
  // `null` is not reported here — it surfaces as the nullability change below instead.
  const prevTypes = nonNullTypes(prevNode.type);
  const nextTypes = nonNullTypes(nextNode.type);
  if (!sameMembers(prevTypes, nextTypes)) {
    findings.push(
      `type change at ${path}: ${describeTypes(prevTypes)} -> ${describeTypes(nextTypes)}`,
    );
  }

  // Nullability / null-semantics change: a field becoming nullable (or ceasing to be) changes the
  // accepted value space (空值语义).
  const prevNullable = isNullable(prevNode);
  const nextNullable = isNullable(nextNode);
  if (prevNullable !== nextNullable) {
    findings.push(`nullability change at ${path}`);
  }
  if (prevNode.nullSemantics !== nextNode.nullSemantics) {
    findings.push(
      `nullSemantics change at ${path}: ${String(prevNode.nullSemantics)} -> ${String(
        nextNode.nullSemantics,
      )}`,
    );
  }

  // Bound tightening (收紧合法输入): a newly introduced or narrower min/max bound rejects input
  // that was previously legal. Removing or widening a bound is compatible.
  if (tightensMin(prevNode.minLength, nextNode.minLength)) {
    findings.push(`minLength tightened at ${path}`);
  }
  if (tightensMax(prevNode.maxLength, nextNode.maxLength)) {
    findings.push(`maxLength tightened at ${path}`);
  }
  if (tightensMin(prevNode.minimum, nextNode.minimum)) {
    findings.push(`minimum tightened at ${path}`);
  }
  if (tightensMax(prevNode.maximum, nextNode.maximum)) {
    findings.push(`maximum tightened at ${path}`);
  }

  // Enum membership. An explicitly-open enum may gain values (consumers degrade safely on unknown
  // values); a closed enum's membership may not change at all.
  if (prevNode.enum !== undefined) {
    if (nextNode.enum === undefined) {
      findings.push(`enum removed at ${path}`);
    } else {
      const open = nextNode.openEnum === true;
      for (const value of prevNode.enum) {
        if (!nextNode.enum.includes(value)) {
          findings.push(`enum value removed at ${path}: ${value}`);
        }
      }
      for (const value of nextNode.enum) {
        if (!prevNode.enum.includes(value) && !open) {
          findings.push(`enum value added at ${path}: ${value}`);
        }
      }
    }
  } else if (nextNode.enum !== undefined) {
    // A plain field became an enum: type/meaning change, fail-closed.
    findings.push(`enum introduced at ${path}`);
  }

  // Optional → required: a field absent from prev.required but present in next.required.
  if (prevNode.required !== undefined && nextNode.required !== undefined) {
    for (const field of nextNode.required) {
      if (!prevNode.required.includes(field)) {
        findings.push(`field became required at ${path}.${field}`);
      }
    }
  }

  // defaultSort change (默认排序).
  if (prevNode.defaultSort !== nextNode.defaultSort) {
    findings.push(`defaultSort change at ${path}`);
  }

  // Object properties: removal is incompatible; a new field is a compatible pure addition.
  if (prevNode.properties !== undefined && nextNode.properties !== undefined) {
    for (const field of Object.keys(prevNode.properties)) {
      const nextField = nextNode.properties[field];
      if (nextField === undefined) {
        findings.push(`removed field ${path}.${field}`);
        continue;
      }
      const prevField = prevNode.properties[field];
      if (prevField === undefined) continue;
      compareNode(prevField, nextField, `${path}.${field}`, findings);
    }
  } else if (prevNode.properties !== undefined || nextNode.properties !== undefined) {
    // One side is an object and the other is not: the type check above already reports the type
    // change; this line is a fail-closed guard for same-type object vs non-object shape change.
    findings.push(`object shape change at ${path}`);
  }

  // Array element shape.
  if (prevNode.items !== undefined || nextNode.items !== undefined) {
    if (prevNode.items === undefined || nextNode.items === undefined) {
      findings.push(`array element shape change at ${path}`);
    } else {
      compareNode(prevNode.items, nextNode.items, `${path}[].items`, findings);
    }
  }

  // Union (anyOf): any membership change is reported (fail-closed).
  if (prevNode.anyOf !== undefined || nextNode.anyOf !== undefined) {
    if (prevNode.anyOf === undefined || nextNode.anyOf === undefined) {
      findings.push(`union shape change at ${path}`);
    } else if (prevNode.anyOf.length !== nextNode.anyOf.length) {
      findings.push(`union arity change at ${path}`);
    } else {
      for (let i = 0; i < prevNode.anyOf.length; i++) {
        const prevMember = prevNode.anyOf[i];
        const nextMember = nextNode.anyOf[i];
        if (prevMember !== undefined && nextMember !== undefined) {
          compareNode(prevMember, nextMember, `${path}[${String(i)}]`, findings);
        }
      }
    }
  }

  // Map value shape (rec() additionalProperties schema).
  if (prevNode.additionalProperties !== undefined || nextNode.additionalProperties !== undefined) {
    if (
      prevNode.additionalProperties === undefined ||
      nextNode.additionalProperties === undefined
    ) {
      findings.push(`map value shape change at ${path}`);
    } else {
      compareNode(
        prevNode.additionalProperties,
        nextNode.additionalProperties,
        `${path}[value]`,
        findings,
      );
    }
  }
}

function nonNullTypes(type: string | readonly string[] | undefined): readonly string[] {
  if (type === undefined) return [];
  const members = typeof type === 'string' ? [type] : [...type];
  return members.filter((member) => member !== 'null').sort();
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function describeTypes(types: readonly string[]): string {
  return types.length === 0 ? '(none)' : types.join('|');
}

function isNullable(node: SchemaCompatibilityNode): boolean {
  const type = node.type;
  if (type === undefined) return false;
  return typeof type === 'string' ? type === 'null' : type.includes('null');
}

function tightensMin(prev: number | undefined, next: number | undefined): boolean {
  if (next === undefined) return false; // removed lower bound → widening
  return prev === undefined || next > prev;
}

function tightensMax(prev: number | undefined, next: number | undefined): boolean {
  if (next === undefined) return false; // removed upper bound → widening
  return prev === undefined || next < prev;
}
