import { enum_, obj, str, union } from './schema.js';
import type { SchemaDef } from './schema.js';

export const sectionStatus = enum_([
  'available',
  'empty',
  'partial',
  'stale',
  'unavailable',
  'forbidden',
]);

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- <T> is part of the approved contract surface; SchemaDef erases it, so it is only pinned here
export function sectionResult<T>(data: SchemaDef): SchemaDef {
  void (0 as unknown as T);
  return union([
    obj({ status: enum_(['available']), data }),
    obj({ status: enum_(['empty']), reason: str(1, 256) }),
    obj({ status: enum_(['partial']), data, missing: str(1, 256) }),
    obj({ status: enum_(['stale']), data, freshAt: str(20, 24), staleReason: str(1, 256) }),
    obj({ status: enum_(['unavailable']), reason: str(1, 256) }),
    obj({ status: enum_(['forbidden']) }),
  ]);
}
