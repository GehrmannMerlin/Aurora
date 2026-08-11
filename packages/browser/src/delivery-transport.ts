import { parseIngestionRequestReceipt } from '@aurora/event-schema';
import type { SdkBatchTransport, SdkTransportContext, SdkTransportResult } from '@aurora/sdk';

/**
 * Minimal structural response contract for the injected fetch-like function.
 * Describes only the capabilities `createBrowserBatchTransport` actually uses so the
 * public declaration stays free of DOM globals (`fetch`, `Response`, `RequestInit`, …)
 * and remains consumable by no-DOM typecheck consumers.
 */
export interface BrowserFetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}

/** Minimal structural request options for the injected fetch-like function. */
export interface BrowserFetchRequestInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly keepalive?: boolean;
}

/** Minimal structural fetch-like function, independent of DOM globals. */
export type BrowserFetchLike = (
  input: string,
  init?: BrowserFetchRequestInit,
) => Promise<BrowserFetchResponseLike>;

export interface CreateBrowserBatchTransportOptions {
  readonly ingestEndpoint: string;
  readonly fetchImpl?: BrowserFetchLike;
}

function readRetryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return undefined;
  return seconds * 1000;
}

/**
 * Browser transport for the SDK delivery chain. Sends `POST {endpoint}/v1/batches`
 * with the chain-provided headers (`X-Aurora-Client-Key`, `X-Aurora-Environment`),
 * uses `keepalive` in best-effort (page-exit) mode, and maps HTTP/network outcomes
 * to `SdkTransportResult`. Never throws; all failures surface as stable results.
 */
export function createBrowserBatchTransport(
  options: CreateBrowserBatchTransportOptions,
): SdkBatchTransport {
  const fetchImpl =
    options.fetchImpl ?? ((input: string, init?: BrowserFetchRequestInit) => fetch(input, init));
  const base = options.ingestEndpoint === '' ? '' : options.ingestEndpoint.replace(/\/+$/, '');
  const endpoint = base === '' ? '' : `${base}/v1/batches`;

  async function send(
    request: Parameters<SdkBatchTransport['send']>[0],
    context: SdkTransportContext,
  ): Promise<SdkTransportResult> {
    if (endpoint === '') return { kind: 'http_error', status: 0 };
    let response: BrowserFetchResponseLike;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: context.headers,
        body: JSON.stringify(request),
        keepalive: context.mode === 'best_effort',
      });
    } catch {
      return { kind: 'transport_failure', reason: 'network' };
    }
    const retryAfterMs = readRetryAfterMs(response.headers.get('Retry-After'));
    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch {
      return { kind: 'transport_failure', reason: 'network' };
    }
    let parsedBody: unknown = undefined;
    try {
      parsedBody = bodyText.length === 0 ? undefined : JSON.parse(bodyText);
    } catch {
      parsedBody = undefined;
    }
    if (response.ok) {
      const receiptResult =
        parsedBody === undefined
          ? { success: false as const }
          : parseIngestionRequestReceipt(parsedBody);
      if (receiptResult.success) {
        return { kind: 'success', status: response.status, receipt: receiptResult.data };
      }
      return { kind: 'transport_failure', reason: 'network' };
    }
    const receipt =
      parsedBody === undefined
        ? undefined
        : (() => {
            const parsed = parseIngestionRequestReceipt(parsedBody);
            return parsed.success ? parsed.data : undefined;
          })();
    return {
      kind: 'http_error',
      status: response.status,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      ...(receipt !== undefined ? { receipt } : {}),
    };
  }

  return Object.freeze({ send });
}
