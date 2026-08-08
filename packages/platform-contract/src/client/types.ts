import type { HttpMethod } from '../registry/operations.js';

export interface OperationRequest {
  readonly operationId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly body?: unknown;
  readonly query?: unknown;
}

export type OperationResult =
  | {
      readonly ok: true;
      readonly operationId: string;
      readonly status: number;
      readonly data: unknown;
    }
  | {
      readonly ok: false;
      readonly operationId: string;
      readonly status: number;
      readonly problem: unknown;
    };
