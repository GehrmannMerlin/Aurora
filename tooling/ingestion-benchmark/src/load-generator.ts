import { CURRENT_PROTOCOL_VERSION } from '@aurora/event-schema';
import type { BenchmarkCredential } from './credentials.js';
import { benchmarkEventFor } from './event-factory.js';
import type { BoundedSample } from './bounded-sample.js';
import type { BenchmarkScenarioConfig } from './types.js';

export interface HttpLoadResult {
  readonly requests: number;
  readonly events: number;
  readonly accepted: number;
  readonly duplicate: number;
  readonly rejected: number;
  readonly latencies: BoundedSample;
  readonly allResponsesHaveRequestId: boolean;
  readonly unexpected4xx5xx: string[];
  readonly firstEventId: number;
}

interface ReceiptEvent {
  readonly state?: string;
}

interface ReceiptBody {
  readonly perEventResults?: readonly ReceiptEvent[];
  readonly batchState?: string;
}

/**
 * Drive real loopback HTTP batches against the running ingestion API. Sends the
 * exact Origin the credential allows, the real client key and environment.
 * Records per-request latency via performance.now(); never Date.now().
 */
export async function runHttpLoad(params: {
  readonly baseUrl: string;
  readonly credential: BenchmarkCredential;
  readonly runId: string;
  readonly config: BenchmarkScenarioConfig;
  readonly httpConcurrency: number;
  readonly latencies: BoundedSample;
  readonly firstEventId: number;
}): Promise<HttpLoadResult> {
  const { baseUrl, credential, runId, config, httpConcurrency, latencies, firstEventId } = params;
  const totalEvents = config.warmupEvents + config.measuredEvents;
  const batchCount = Math.ceil(totalEvents / config.batchSize);

  let requests = 0;
  let events = 0;
  let accepted = 0;
  let duplicate = 0;
  let rejected = 0;
  let allResponsesHaveRequestId = true;
  const unexpected4xx5xx: string[] = [];

  let nextEventId = firstEventId;

  const sendBatch = async (batchIndex: number): Promise<void> => {
    const batchStart = batchIndex * config.batchSize;
    const count = Math.min(config.batchSize, totalEvents - batchStart);
    const occurredAt = Date.now();
    const eventsInBatch = [];
    for (let i = 0; i < count; i += 1) {
      eventsInBatch.push(benchmarkEventFor(runId, nextEventId, occurredAt));
      nextEventId += 1;
    }
    const body = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      events: eventsInBatch,
      receivedAt: occurredAt,
    };
    const startedAt = performance.now();
    const response = await fetch(`${baseUrl}/v1/batches`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': credential.clientKey,
        'x-aurora-environment': credential.environment,
        origin: credential.origin,
      },
      body: JSON.stringify(body),
    });
    const latencyMs = performance.now() - startedAt;
    latencies.push(latencyMs);

    const requestId = response.headers.get('x-aurora-request-id');
    if (requestId === null || requestId === '') {
      allResponsesHaveRequestId = false;
    }
    requests += 1;
    events += eventsInBatch.length;

    const text = await response.text();
    if (response.status >= 400 && response.status < 600) {
      unexpected4xx5xx.push(String(response.status));
      return;
    }
    let receipt: ReceiptBody;
    try {
      receipt = JSON.parse(text) as ReceiptBody;
    } catch {
      rejected += eventsInBatch.length;
      return;
    }
    const results = receipt.perEventResults ?? [];
    for (const event of results) {
      if (event.state === 'accepted') accepted += 1;
      else if (event.state === 'duplicate_accepted') duplicate += 1;
      else rejected += 1;
    }
  };

  const worker = async (start: number, end: number): Promise<void> => {
    for (let i = start; i < end; i += 1) {
      await sendBatch(i);
    }
  };

  const batchesPerWorker = Math.ceil(batchCount / httpConcurrency);
  const workers = [];
  for (let w = 0; w < httpConcurrency; w += 1) {
    const start = w * batchesPerWorker;
    const end = Math.min(batchCount, start + batchesPerWorker);
    if (start < end) workers.push(worker(start, end));
  }
  await Promise.all(workers);

  return {
    requests,
    events,
    accepted,
    duplicate,
    rejected,
    latencies,
    allResponsesHaveRequestId,
    unexpected4xx5xx,
    firstEventId: nextEventId,
  };
}
