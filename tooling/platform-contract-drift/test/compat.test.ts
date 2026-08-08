import { describe, expect, it } from 'vitest';
import {
  assertPlatformDrift,
  buildCompatibilityBaseline,
  detectIncompatibleChanges,
  type CompatibilityBaseline,
  type SchemaCompatibilityNode,
} from '../src/index.js';

// Real-behavior fixtures: baseline documents are built by hand (no mocks), mirroring the shape
// buildCompatibilityBaseline produces from PLATFORM_OPERATIONS. Each test drives the pure
// detectIncompatibleChanges directly.

function baseline(
  operations: Readonly<Record<string, Readonly<Record<string, SchemaCompatibilityNode>>>>,
): CompatibilityBaseline {
  const operationBaselines: Record<
    string,
    { responses: Readonly<Record<string, SchemaCompatibilityNode>> }
  > = {};
  for (const [opId, responses] of Object.entries(operations)) {
    operationBaselines[opId] = { responses };
  }
  return {
    version: 'v1',
    generatedBy: 'packages/platform-contract/scripts/generate-openapi.ts',
    operations: operationBaselines,
  };
}

function objectNode(
  properties: Readonly<Record<string, SchemaCompatibilityNode>>,
  required: readonly string[] = [],
): SchemaCompatibilityNode {
  return { type: 'object', properties, required };
}

describe('platform-contract compatibility gate', () => {
  it('reports nothing for identical baselines', () => {
    const prev = baseline({
      identityGetSession: { '200': objectNode({ account: { type: 'string' } }, ['account']) },
    });
    const next = baseline({
      identityGetSession: { '200': objectNode({ account: { type: 'string' } }, ['account']) },
    });
    expect(detectIncompatibleChanges(prev, next)).toEqual([]);
  });

  it('reports a removed response field', () => {
    const prev = baseline({
      op: { '200': objectNode({ a: { type: 'string' }, b: { type: 'number' } }, ['a', 'b']) },
    });
    const next = baseline({ op: { '200': objectNode({ a: { type: 'string' } }, ['a']) } });
    expect(detectIncompatibleChanges(prev, next)).toContain('removed field op 200 response.b');
  });

  it('reports a removed operation', () => {
    const prev = baseline({ identityGetSession: { '200': objectNode({}) } });
    const next = baseline({});
    expect(detectIncompatibleChanges(prev, next)).toContain('removed operation identityGetSession');
  });

  it('reports a field type change', () => {
    const prev = baseline({ op: { '200': objectNode({ a: { type: 'string' } }, ['a']) } });
    const next = baseline({ op: { '200': objectNode({ a: { type: 'number' } }, ['a']) } });
    expect(detectIncompatibleChanges(prev, next)).toContain(
      'type change at op 200 response.a: string -> number',
    );
  });

  it('reports an optional field becoming required', () => {
    const prev = baseline({ op: { '200': objectNode({ a: { type: 'string' } }, []) } });
    const next = baseline({ op: { '200': objectNode({ a: { type: 'string' } }, ['a']) } });
    expect(detectIncompatibleChanges(prev, next)).toContain(
      'field became required at op 200 response.a',
    );
  });

  it('reports a closed enum value removed', () => {
    const prev = baseline({
      op: {
        '200': objectNode({ s: { type: 'string', enum: ['a', 'b'], openEnum: false } }, ['s']),
      },
    });
    const next = baseline({
      op: { '200': objectNode({ s: { type: 'string', enum: ['a'], openEnum: false } }, ['s']) },
    });
    expect(detectIncompatibleChanges(prev, next)).toContain(
      'enum value removed at op 200 response.s: b',
    );
  });

  it('reports a closed enum value added', () => {
    const prev = baseline({
      op: { '200': objectNode({ s: { type: 'string', enum: ['a'], openEnum: false } }, ['s']) },
    });
    const next = baseline({
      op: {
        '200': objectNode({ s: { type: 'string', enum: ['a', 'b'], openEnum: false } }, ['s']),
      },
    });
    expect(detectIncompatibleChanges(prev, next)).toContain(
      'enum value added at op 200 response.s: b',
    );
  });

  it('reports a closed enum value renamed (remove + add)', () => {
    const prev = baseline({
      op: { '200': objectNode({ s: { type: 'string', enum: ['old'], openEnum: false } }, ['s']) },
    });
    const next = baseline({
      op: { '200': objectNode({ s: { type: 'string', enum: ['new'], openEnum: false } }, ['s']) },
    });
    const findings = detectIncompatibleChanges(prev, next);
    expect(findings).toContain('enum value removed at op 200 response.s: old');
    expect(findings).toContain('enum value added at op 200 response.s: new');
  });

  it('allows an explicitly-open enum to gain a value', () => {
    const prev = baseline({
      op: { '200': objectNode({ s: { type: 'string', enum: ['a'], openEnum: true } }, ['s']) },
    });
    const next = baseline({
      op: { '200': objectNode({ s: { type: 'string', enum: ['a', 'b'], openEnum: true } }, ['s']) },
    });
    expect(detectIncompatibleChanges(prev, next)).toEqual([]);
  });

  it('allows a new optional response field', () => {
    const prev = baseline({ op: { '200': objectNode({ a: { type: 'string' } }, ['a']) } });
    const next = baseline({
      op: { '200': objectNode({ a: { type: 'string' }, b: { type: 'number' } }, ['a']) },
    });
    expect(detectIncompatibleChanges(prev, next)).toEqual([]);
  });

  it('reports a minLength tightening', () => {
    const prev = baseline({
      op: { '200': objectNode({ s: { type: 'string', minLength: 1 } }, ['s']) },
    });
    const next = baseline({
      op: { '200': objectNode({ s: { type: 'string', minLength: 3 } }, ['s']) },
    });
    expect(detectIncompatibleChanges(prev, next)).toContain(
      'minLength tightened at op 200 response.s',
    );
  });

  it('reports a maximum tightening and allows a maximum widening', () => {
    const prev = baseline({
      op: { '200': objectNode({ n: { type: 'number', maximum: 100 } }, ['n']) },
    });
    const tightened = baseline({
      op: { '200': objectNode({ n: { type: 'number', maximum: 50 } }, ['n']) },
    });
    const widened = baseline({
      op: { '200': objectNode({ n: { type: 'number', maximum: 200 } }, ['n']) },
    });
    expect(detectIncompatibleChanges(prev, tightened)).toContain(
      'maximum tightened at op 200 response.n',
    );
    expect(detectIncompatibleChanges(prev, widened)).toEqual([]);
  });

  it('reports a nullability change (type list gains null)', () => {
    const prev = baseline({ op: { '200': objectNode({ s: { type: 'string' } }, ['s']) } });
    const next = baseline({
      op: { '200': objectNode({ s: { type: ['string', 'null'] } }, ['s']) },
    });
    expect(detectIncompatibleChanges(prev, next)).toContain(
      'nullability change at op 200 response.s',
    );
  });

  it('reports a defaultSort change', () => {
    const prev = baseline({ op: { '200': { type: 'object', defaultSort: ['createdAt'] } } });
    const next = baseline({ op: { '200': { type: 'object', defaultSort: ['updatedAt'] } } });
    expect(detectIncompatibleChanges(prev, next)).toContain(
      'defaultSort change at op 200 response',
    );
  });

  it('full gate passes against the committed artifact', async () => {
    await expect(assertPlatformDrift()).resolves.toBeUndefined();
  });

  it('regenerates the committed baseline identically from the current operations', async () => {
    const { readFile } = await import('node:fs/promises');
    const { PLATFORM_OPERATIONS } = await import('@aurora/platform-contract');
    const manifestText = await readFile(
      new URL('../../../docs/api/platform-openapi-v1.manifest.json', import.meta.url),
      'utf8',
    );
    const manifest = JSON.parse(manifestText) as { compatibilityBaseline: CompatibilityBaseline };
    expect(buildCompatibilityBaseline(PLATFORM_OPERATIONS)).toEqual(manifest.compatibilityBaseline);
  });
});

describe('manifest capability enumeration (spec §37.12)', () => {
  it('maps every capability to a real contract export', async () => {
    const { readFile } = await import('node:fs/promises');
    const contract = await import('@aurora/platform-contract');
    const manifestText = await readFile(
      new URL('../../../docs/api/platform-openapi-v1.manifest.json', import.meta.url),
      'utf8',
    );
    const manifest = JSON.parse(manifestText) as {
      readonly capabilities: readonly {
        readonly capability: string;
        readonly schemaExports: readonly string[];
      }[];
    };
    expect(manifest.capabilities.length).toBeGreaterThan(0);
    for (const capability of manifest.capabilities) {
      expect(capability.capability.length).toBeGreaterThan(0);
      expect(capability.schemaExports.length).toBeGreaterThan(0);
      for (const name of capability.schemaExports) {
        expect(contract, name).toHaveProperty(name);
      }
    }
  });
});
