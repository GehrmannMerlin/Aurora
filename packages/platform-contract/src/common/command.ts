import { enum_, obj, str } from './schema.js';
import type { SchemaDef } from './schema.js';
import { OperationId } from './identifiers.js';
import { navigationTargets } from './navigation.js';

export const idempotencyKey = str(36, 36);

export const resourceVersion = str(1, 64);

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- <T> is part of the approved contract surface; SchemaDef erases it, so it is only pinned here
export function commandResult<T>(data: SchemaDef): SchemaDef {
  void (0 as unknown as T);
  return obj({
    status: enum_(['succeeded', 'duplicate']),
    data,
    resourceVersion,
    operationId: OperationId,
    navigationTargets,
  });
}
