import { obj, optional, rec, str } from './schema.js';
import type { SchemaDef } from './schema.js';
import { readAt } from './time.js';
import { allowedActions } from './authorization.js';
import { navigationTargets } from './navigation.js';

export const normalizedQuery = rec(str(1, 512));

export const queryMeta = obj({
  requestId: str(1, 64),
  readAt,
  normalizedQuery: optional(normalizedQuery),
});

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- <T> is part of the approved contract surface; SchemaDef erases it, so it is only pinned here
export function queryResponse<T>(data: SchemaDef): SchemaDef {
  void (0 as unknown as T);
  return obj({
    data,
    meta: queryMeta,
    allowedActions,
    navigationTargets,
  });
}
