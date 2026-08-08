import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { PLATFORM_OPERATIONS, OPERATION_MANIFEST } from '@aurora/platform-contract';

// NOTE: from tooling/platform-contract-drift/src/index.ts, THREE levels up is required to reach
// the repo root. The brief originally specified four ('../../../../'), which empirically resolves
// to .claude/worktrees/docs/api/platform-openapi-v1.yaml (does not exist). Three levels up is
// verified to resolve to the repo docs/api/platform-openapi-v1.yaml. See task-11-report.md.
const ARTIFACT = fileURLToPath(
  new URL('../../../docs/api/platform-openapi-v1.yaml', import.meta.url),
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
  const doc = parse(body) as {
    paths?: Record<
      string,
      {
        get?: { operationId?: string };
        post?: { operationId?: string };
        patch?: { operationId?: string };
        delete?: { operationId?: string };
      }
    >;
  };

  const drifts: string[] = [];
  const yamlOps = new Set<string>();
  for (const path of Object.values(doc.paths ?? {})) {
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
  if (OPERATION_MANIFEST.routeTargetCoverage['platform.resource-policies'] !== 'unavailable') {
    drifts.push('platform.resource-policies must remain unavailable (D2 gate)');
  }
  if (drifts.length > 0) throw new PlatformDriftError(drifts);
}
