export type CoreDiagnosticCode =
  | 'invalid_configuration'
  | 'configuration_locked'
  | 'invalid_lifecycle_call'
  | 'invalid_plugin'
  | 'duplicate_plugin'
  | 'plugin_initialize_failed'
  | 'plugin_start_failed'
  | 'plugin_stop_failed'
  | 'plugin_destroy_failed'
  | 'invalid_event'
  | 'event_rejected'
  | 'internal_error';

export type CoreDiagnosticOperation =
  | 'initialize'
  | 'update_config'
  | 'register_plugin'
  | 'start'
  | 'stop'
  | 'destroy'
  | 'submit_event';

export interface CoreDiagnostic {
  readonly sequence: number;
  readonly code: CoreDiagnosticCode;
  readonly operation: CoreDiagnosticOperation;
  readonly pluginName?: string;
}

export interface DiagnosticInput {
  readonly code: CoreDiagnosticCode;
  readonly operation: CoreDiagnosticOperation;
  readonly pluginName?: string;
}

export class DiagnosticStore {
  readonly #entries: CoreDiagnostic[] = [];
  #capacity: number;
  #nextSequence = 1;

  public constructor(capacity: number) {
    this.#capacity = capacity;
  }

  public add(input: DiagnosticInput): void {
    const common = {
      sequence: this.#nextSequence,
      code: input.code,
      operation: input.operation,
    };
    const entry: CoreDiagnostic =
      input.pluginName === undefined
        ? Object.freeze(common)
        : Object.freeze({ ...common, pluginName: input.pluginName });
    this.#nextSequence += 1;
    this.#entries.push(entry);
    this.trim();
  }

  public setCapacity(capacity: number): void {
    this.#capacity = capacity;
    this.trim();
  }

  public snapshot(): readonly CoreDiagnostic[] {
    return Object.freeze(this.#entries.map((entry) => Object.freeze({ ...entry })));
  }

  private trim(): void {
    const overflow = this.#entries.length - this.#capacity;
    if (overflow > 0) this.#entries.splice(0, overflow);
  }
}
