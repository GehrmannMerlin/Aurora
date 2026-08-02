export const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 512;

export const DIAGNOSTIC_LIMIT_DEFAULT = 100;

/** Stable diagnostic fields; never carries event bodies, errors, SQL, or secrets. */
export interface WorkerDiagnostic {
  readonly operation: string;
  readonly code: string;
  readonly workerId: string;
  readonly timestamp: Date;
  readonly inboxId?: number;
  readonly eventType?: string;
  readonly attemptCount?: number;
  readonly maxProcessingAttempts?: number;
  readonly leaseLost?: boolean;
  readonly message?: string;
}

export interface RecordWorkerDiagnosticInput {
  readonly operation: string;
  readonly code: string;
  readonly workerId: string;
  readonly inboxId?: number;
  readonly eventType?: string;
  readonly attemptCount?: number;
  readonly maxProcessingAttempts?: number;
  readonly leaseLost?: boolean;
  readonly message?: string;
}

/** Per-instance bounded ring buffer of worker diagnostics. */
export class WorkerDiagnostics {
  private readonly buffer: WorkerDiagnostic[];

  constructor(
    private readonly workerId: string,
    private readonly limit: number = DIAGNOSTIC_LIMIT_DEFAULT,
  ) {
    this.buffer = [];
  }

  record(input: RecordWorkerDiagnosticInput): void {
    const message = input.message === undefined ? undefined : input.message.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH);
    const entry: WorkerDiagnostic = Object.freeze({
      operation: input.operation,
      code: input.code,
      workerId: this.workerId,
      timestamp: new Date(),
      ...(input.inboxId === undefined ? {} : { inboxId: input.inboxId }),
      ...(input.eventType === undefined ? {} : { eventType: input.eventType }),
      ...(input.attemptCount === undefined ? {} : { attemptCount: input.attemptCount }),
      ...(input.maxProcessingAttempts === undefined
        ? {}
        : { maxProcessingAttempts: input.maxProcessingAttempts }),
      ...(input.leaseLost === undefined ? {} : { leaseLost: input.leaseLost }),
      ...(message === undefined ? {} : { message }),
    });
    this.buffer.push(entry);
    if (this.buffer.length > this.limit) {
      this.buffer.splice(0, this.buffer.length - this.limit);
    }
  }

  snapshot(): readonly WorkerDiagnostic[] {
    return Object.freeze(
      this.buffer.map((entry) => Object.freeze({ ...entry })),
    );
  }
}
