import { arr, enum_, num, obj, optional, str } from './schema.js';
import type { SchemaDef } from './schema.js';

export const cursorPage = obj({ cursor: optional(str(1, 64)), limit: num(1, 100) });

export const pageNumber = obj({ page: num(1), pageSize: num(1, 100) });

export const totalCountStatus = enum_(['available', 'unavailable']);

export const paginationMeta = obj({
  // Opaque keyset cursors can carry base64url(method\nurl) endpoint cursors
  // (DAT-16): a real URL far exceeds 64 chars, so the bound must be wide enough
  // for encoded cursors (400-char URL ~= 534 base64url chars). Widened from 64
  // to 4096 as a non-breaking relaxation (previously-valid values remain valid).
  cursor: optional(str(1, 4096)),
  nextCursor: optional(str(1, 4096)),
  totalCount: optional(num(0)),
  totalCountStatus,
});

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- <T> is part of the approved contract surface; SchemaDef erases it, so it is only pinned here
export function pageResult<T>(item: SchemaDef): SchemaDef {
  void (0 as unknown as T);
  return obj({ items: arr(item), pagination: paginationMeta });
}

export type PaginationModel = 'cursor' | 'page';
