import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { PLATFORM_OPERATIONS } from '@aurora/platform-contract';
import {
  buildCompatibilityBaseline,
  detectIncompatibleChanges,
  type CompatibilityBaseline,
} from './compat.js';

// The committed OpenAPI is a trusted, self-generated, version-controlled artifact. yaml's default
// maxAliasCount (100) is a DoS guard for untrusted input; the generator emits anchors/aliases for
// every repeated shared schema reference, and the count grows with the operation set (DAT-20's
// diagnostics op crossed 100). 1000 keeps headroom for future stable ops without disabling the guard.
const PARSE_OPTIONS = { maxAliasCount: 1000 } as const;

// NOTE: from tooling/platform-contract-drift/src/index.ts, THREE levels up is required to reach
// the repo root. The brief originally specified four ('../../../../'), which empirically resolves
// to .claude/worktrees/docs/api/platform-openapi-v1.yaml (does not exist). Three levels up is
// verified to resolve to the repo docs/api/platform-openapi-v1.yaml. See task-11-report.md.
const ARTIFACT = fileURLToPath(
  new URL('../../../docs/api/platform-openapi-v1.yaml', import.meta.url),
);
const MANIFEST = fileURLToPath(
  new URL('../../../docs/api/platform-openapi-v1.manifest.json', import.meta.url),
);
const HEADER = '# 由契约源码生成、禁止手工修改\n';

export class PlatformDriftError extends Error {
  constructor(readonly drifts: readonly string[]) {
    super(`platform contract drift detected:\n- ${drifts.join('\n- ')}`);
    this.name = 'PlatformDriftError';
  }
}

export function detectUnregisteredOperations(ops: readonly { operationId: string }[]): string[] {
  const registered = new Set(PLATFORM_OPERATIONS.map((o) => o.operationId));
  return ops.filter((o) => !registered.has(o.operationId)).map((o) => o.operationId);
}

export async function assertPlatformDrift(): Promise<void> {
  const yamlText = await readFile(ARTIFACT, 'utf8');
  const body = yamlText.startsWith(HEADER) ? yamlText.slice(HEADER.length) : yamlText;
  const doc = parse(body, PARSE_OPTIONS) as {
    paths?: Record<
      string,
      {
        get?: { operationId?: string };
        post?: { operationId?: string };
        patch?: { operationId?: string };
        delete?: { operationId?: string };
      }
    >;
  } | null;

  const drifts: string[] = [];
  const yamlOps = new Set<string>();
  for (const path of Object.values(doc?.paths ?? {})) {
    for (const method of ['get', 'post', 'patch', 'delete'] as const) {
      const opId = path[method]?.operationId;
      if (opId) yamlOps.add(opId);
    }
  }

  for (const op of PLATFORM_OPERATIONS) {
    if (!yamlOps.has(op.operationId)) drifts.push(`missing stable operation ${op.operationId}`);
  }
  for (const opId of yamlOps) {
    if (!PLATFORM_OPERATIONS.some((o) => o.operationId === opId))
      drifts.push(`unregistered operation ${opId}`);
  }

  // Schema-level compatibility gate (spec §30 / ADR-027 决定细节 6). The committed baseline inside
  // the generated manifest is compared against a fresh in-memory projection of the current
  // PLATFORM_OPERATIONS schema tree. Any same-major-version incompatible change is reported.
  const manifestText = await readFile(MANIFEST, 'utf8');
  const manifest = JSON.parse(manifestText) as { readonly compatibilityBaseline?: unknown };
  const committedBaseline = manifest.compatibilityBaseline as CompatibilityBaseline | undefined;
  if (committedBaseline === undefined) {
    drifts.push(
      'manifest missing compatibilityBaseline (regenerate with pnpm platform-contract:generate)',
    );
  } else {
    const currentBaseline = buildCompatibilityBaseline(PLATFORM_OPERATIONS);
    for (const incompatibility of detectIncompatibleChanges(committedBaseline, currentBaseline)) {
      drifts.push(`compat: ${incompatibility}`);
    }
  }

  if (drifts.length > 0) throw new PlatformDriftError(drifts);
}

export {
  buildCompatibilityBaseline,
  detectIncompatibleChanges,
  type CompatibilityBaseline,
  type OperationCompatibilityBaseline,
  type SchemaCompatibilityNode,
} from './compat.js';
