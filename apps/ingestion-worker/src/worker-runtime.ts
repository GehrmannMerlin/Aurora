import type {
  ClaimedInboxEvent,
  IngestionInboxProcessingRepository,
  InboxLeaseMutationResult,
} from '@aurora/ingestion-inbox';
import type { IngestionErrorCode } from '@aurora/event-schema';
import type { IngestionEventProcessor } from './processor.js';
import {
  WorkerDiagnostics,
  type RecordWorkerDiagnosticInput,
} from './diagnostics.js';
import { defaultWorkerTimingPorts, type WorkerTimingPorts } from './timers.js';
import type { IngestionWorkerConfig } from './configuration.js';
import { decideRetryDisposition } from './retry-policy.js';

export type WorkerRuntimeStatus = 'created' | 'running' | 'stopping' | 'stopped';

export interface WorkerRuntime {
  readonly status: WorkerRuntimeStatus;
  readonly diagnostics: WorkerDiagnostics;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface BuildIngestionWorkerInput {
  readonly config: IngestionWorkerConfig;
  readonly repository: IngestionInboxProcessingRepository;
  readonly processor: IngestionEventProcessor;
  readonly timers?: WorkerTimingPorts;
  readonly diagnostics?: WorkerDiagnostics;
}

interface InFlightTask {
  readonly id: number;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
}

interface LeaseState {
  lost: boolean;
  ownershipUnknown: boolean;
}

/**
 * Build a Worker runtime. Accepts external dependencies (config, repository,
 * processor, timing ports) and never creates or closes a PostgreSQL Pool.
 * A single instance is stop-once and cannot be restarted.
 */
export function buildIngestionWorker(input: BuildIngestionWorkerInput): WorkerRuntime {
  const timers = input.timers ?? defaultWorkerTimingPorts;
  const diagnostics = input.diagnostics ?? new WorkerDiagnostics(input.config.workerId);
  const stopSignal = new AbortController();

  let status: WorkerRuntimeStatus = 'created';
  let loopFinished: Promise<void> | undefined;
  const inFlight = new Map<number, InFlightTask>();

  const remainingCapacity = (): number =>
    Math.max(0, input.config.maxConcurrentHandlers - inFlight.size);

  /** Read an AbortSignal's aborted state through a call so type narrowing does not assume it is false. */
  const isAborted = (signal: AbortSignal): boolean => signal.aborted;

  /** Sleep for a duration, tolerating abort rejection (returns immediately on abort). */
  const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
    timers.sleeper.sleep(ms, signal).catch(() => undefined);

  const record = (entry: Omit<RecordWorkerDiagnosticInput, 'workerId'>): void => {
    diagnostics.record({ ...entry, workerId: input.config.workerId });
  };

  const eventTypeOf = (event: ClaimedInboxEvent): string | undefined => {
    const body = event.event as { eventType?: unknown } | null | undefined;
    return typeof body?.eventType === 'string' ? body.eventType : undefined;
  };

  /** Optional diagnostic facts for an event; never carries the event body. */
  type EventFactsDiagnostic = Pick<
    RecordWorkerDiagnosticInput,
    'inboxId' | 'attemptCount' | 'eventType'
  >;

  const factsOf = (event: ClaimedInboxEvent): EventFactsDiagnostic => {
    const facts: { inboxId: number; attemptCount: number; eventType?: string } = {
      inboxId: event.id,
      attemptCount: event.attemptCount,
    };
    const eventType = eventTypeOf(event);
    if (eventType !== undefined) facts.eventType = eventType;
    return facts;
  };

  const runClaimLoop = async (): Promise<void> => {
    while (status === 'running' && !isAborted(stopSignal.signal)) {
      const capacity = remainingCapacity();
      if (capacity <= 0) {
        await sleep(1, stopSignal.signal);
        continue;
      }
      const limit = Math.min(capacity, input.config.claimBatchSize);
      let claimResult;
      try {
        claimResult = await input.repository.claimAvailable({
          limit,
          leaseDurationMs: input.config.leaseDurationMs,
          workerId: input.config.workerId,
        });
      } catch (error) {
        record({
          operation: 'claim',
          code: 'claim_failed',
          message: error instanceof Error ? error.message.slice(0, 200) : 'claim failed',
        });
        await sleep(input.config.infrastructureFailureDelayMs, stopSignal.signal);
        continue;
      }

      if (claimResult.status === 'nothingToClaim') {
        record({ operation: 'claim', code: 'idle' });
        await sleep(input.config.idlePollIntervalMs, stopSignal.signal);
        continue;
      }

      for (const event of claimResult.events) {
        if (isAborted(stopSignal.signal)) break;
        if (inFlight.size >= input.config.maxConcurrentHandlers) break;
        runInFlight(event);
      }
    }
  };

  /** Continuously renew the lease while the task is processing. */
  const runRenewLoop = async (
    event: ClaimedInboxEvent,
    controller: AbortController,
    lease: LeaseState,
  ): Promise<void> => {
    while (!isAborted(controller.signal) && !lease.lost) {
      await sleep(input.config.leaseRenewIntervalMs, controller.signal);
      if (isAborted(controller.signal)) break;
      try {
        const result: InboxLeaseMutationResult = await input.repository.renewLease({
          id: event.id,
          leaseId: event.leaseId,
          leaseDurationMs: input.config.leaseDurationMs,
        });
        if (result.status === 'lease_lost') {
          lease.lost = true;
          record({
            operation: 'renew',
            code: 'lease_lost',
            ...factsOf(event),
            leaseLost: true,
          });
          controller.abort();
          return;
        }
        if (result.status === 'not_found') {
          // The row no longer exists; treat as lost ownership.
          lease.lost = true;
          record({
            operation: 'renew',
            code: 'lease_lost',
            ...factsOf(event),
            leaseLost: true,
          });
          controller.abort();
          return;
        }
        // success: database has extended lease_expires_at (authoritative).
      } catch (error) {
        // Conservative single retry; if it still fails, mark ownership unknown.
        if (!lease.ownershipUnknown) {
          lease.ownershipUnknown = true;
          record({
            operation: 'renew',
            code: 'renew_temporary_failure',
            inboxId: event.id,
            message: error instanceof Error ? error.message.slice(0, 200) : 'renew failed',
          });
          continue;
        }
        // Second failure: stop renewing; write-back will be skipped.
        lease.ownershipUnknown = true;
        return;
      }
    }
  };

  /** Handle one claimed event through the processor and write back the result. */
  const runInFlight = (event: ClaimedInboxEvent): void => {
    const controller = new AbortController();
    const lease: LeaseState = { lost: false, ownershipUnknown: false };
    const facts = factsOf(event);

    const settled = (async () => {
      let result;
      try {
        result = await input.processor.process(
          {
            inboxId: event.id,
            projectId: event.projectId,
            eventId: event.eventId,
            event: event.event,
            attemptCount: event.attemptCount,
            leaseId: event.leaseId,
            leaseExpiresAt: event.leaseExpiresAt,
          },
          controller.signal,
        );
      } catch (error) {
        // Unclassified runtime failure: do not decide retry/dead-letter, do not
        // mark processed. The lease is left to expire naturally and be re-claimed.
        record({
          operation: 'process',
          code: 'processor_failed',
          ...facts,
          message: error instanceof Error ? error.message.slice(0, 200) : 'processor failed',
        });
        return;
      }

      if (lease.lost || lease.ownershipUnknown || isAborted(controller.signal)) {
        record({ operation: 'write-back', code: 'lease_not_owned', ...facts });
        return;
      }

      let writeResult: InboxLeaseMutationResult;
      if (result.outcome === 'processed') {
        writeResult = await input.repository.markProcessed({ id: event.id, leaseId: event.leaseId });
      } else if (result.outcome === 'retry') {
        const disposition = decideRetryDisposition({
          attemptCount: event.attemptCount,
          maxProcessingAttempts: input.config.maxProcessingAttempts,
          availableAt: result.availableAt,
          errorCode: result.errorCode,
        });
        if (disposition.status === 'schedule-retry') {
          writeResult = await input.repository.scheduleRetry({
            id: event.id,
            leaseId: event.leaseId,
            availableAt: disposition.availableAt,
            // The disposition echoes the processor's stable IngestionErrorCode.
            errorCode: disposition.errorCode as IngestionErrorCode,
          });
        } else if (disposition.status === 'dead-letter') {
          // retry_budget_exhausted is a Worker-policy internal stable code; it
          // is not part of the ingestion protocol IngestionErrorCode enum, but
          // the Processing Repository stores last_error_code as an opaque
          // internal code. We keep the Repository signature unchanged and pass
          // the code through its IngestionErrorCode-typed field via a scoped
          // type refinement (the runtime SQL is parameterized and unvalidated).
          writeResult = await input.repository.markDeadLettered({
            id: event.id,
            leaseId: event.leaseId,
            errorCode: disposition.errorCode as IngestionErrorCode,
          });
        } else {
          // Invalid retry result: do not write back; lease expires naturally.
          record({
            operation: 'policy',
            code: 'processor_retry_result_invalid',
            ...facts,
            attemptCount: event.attemptCount,
            maxProcessingAttempts: input.config.maxProcessingAttempts,
          });
          return;
        }
      } else {
        writeResult = await input.repository.markDeadLettered({
          id: event.id,
          leaseId: event.leaseId,
          errorCode: result.errorCode,
        });
      }
      if (writeResult.status === 'lease_lost' || writeResult.status === 'not_found') {
        record({ operation: 'write-back', code: 'lease_lost_on_write_back', ...facts });
      } else {
        record({ operation: 'write-back', code: 'written', ...facts });
      }
    })().finally(() => {
      controller.abort();
      inFlight.delete(event.id);
    });

    // Start renewing only if we still own the capacity and the loop is running.
    if (status === 'running' && !isAborted(stopSignal.signal)) {
      void runRenewLoop(event, controller, lease);
    }
    inFlight.set(event.id, { id: event.id, controller, settled });
  };

  const start = async (): Promise<void> => {
    if (status !== 'created') {
      throw new Error(`cannot start worker in state ${status}`);
    }
    status = 'running';
    loopFinished = runClaimLoop();
    await Promise.resolve();
  };

  const stop = async (): Promise<void> => {
    if (status === 'stopped') return;
    if (status === 'created') {
      status = 'stopped';
      return;
    }
    status = 'stopping';
    stopSignal.abort();
    // Wait for in-flight tasks up to the grace period.
    await Promise.race([
      Promise.all([...inFlight.values()].map((task) => task.settled.catch(() => undefined))),
      sleep(input.config.shutdownGracePeriodMs, undefined),
    ]);
    // Abort any tasks that outlived the grace period; do not force a state change.
    for (const task of inFlight.values()) {
      task.controller.abort();
    }
    // Give aborted handlers a bounded window to settle before releasing the loop.
    await Promise.race([
      Promise.all([...inFlight.values()].map((task) => task.settled.catch(() => undefined))),
      sleep(500, undefined),
    ]);
    await loopFinished?.catch(() => undefined);
    status = 'stopped';
  };

  return {
    get status(): WorkerRuntimeStatus {
      return status;
    },
    diagnostics,
    start,
    stop,
  };
}
