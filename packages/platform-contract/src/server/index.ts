import type { OperationDef, HttpMethod, AuthLevel } from '../registry/operations.js';
import { PLATFORM_OPERATIONS } from '../registry/operations.js';
export { parseInput, serializeOutput, problemSchema } from './adapters.js';
export { PLATFORM_OPERATIONS };
export function listServerOperations(): readonly OperationDef[] {
  return PLATFORM_OPERATIONS;
}
export type { OperationDef, HttpMethod, AuthLevel };
