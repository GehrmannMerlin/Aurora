import type { IngestionBatchRequest, IngestionRequestReceipt } from '@aurora/event-schema';

export type SdkTransportMode = 'normal' | 'best_effort';

export interface SdkTransportContext {
  readonly mode: SdkTransportMode;
  readonly headers: Readonly<Record<string, string>>;
}

export type SdkTransportSuccess = {
  readonly kind: 'success';
  readonly status: number;
  readonly receipt: IngestionRequestReceipt;
};

export type SdkTransportFailure =
  | {
      readonly kind: 'transport_failure';
      readonly reason: 'network' | 'timeout';
      readonly retryAfterMs?: number;
    }
  | {
      readonly kind: 'http_error';
      readonly status: number;
      readonly retryAfterMs?: number;
      readonly receipt?: IngestionRequestReceipt;
    };

export type SdkTransportResult = SdkTransportSuccess | SdkTransportFailure;

export interface SdkBatchTransport {
  readonly send: (
    request: IngestionBatchRequest,
    context: SdkTransportContext,
  ) => Promise<SdkTransportResult>;
}
