import type { IngestionErrorCode } from '@aurora/event-schema';
import { IngestionInboxError } from '@aurora/ingestion-inbox';

export interface ErrorResponse {
  readonly requestId: string;
  readonly message: string;
  readonly errorCode?: IngestionErrorCode;
}

export interface HttpErrorMapping {
  readonly statusCode: number;
  readonly body: ErrorResponse;
}

/** Convert retryAfterMs (ms) to whole seconds by rounding up. */
export function retryAfterSeconds(retryAfterMs: number): number {
  return Math.ceil(retryAfterMs / 1000);
}

/**
 * Map a stable internal failure to an HTTP status and a non-leaking body.
 * Never exposes SQL, stack, constraint names, or internal details.
 */
export function mapErrorToHttp(
  requestId: string,
  error: IngestionInboxError | Error,
): HttpErrorMapping {
  if (error instanceof IngestionInboxError) {
    switch (error.kind) {
      case 'database_unavailable':
        return {
          statusCode: 503,
          body: { requestId, message: 'temporarily unavailable' },
        };
      case 'statement_failed':
        return {
          statusCode: 503,
          body: { requestId, message: 'temporarily unavailable' },
        };
      default:
        return {
          statusCode: 500,
          body: { requestId, message: 'internal error' },
        };
    }
  }
  return { statusCode: 500, body: { requestId, message: 'internal error' } };
}
