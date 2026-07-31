import type { DiagnosticStore } from './diagnostics.js';
import {
  snapshotPlugin,
  type CorePluginContext,
  type RegisteredPlugin,
} from './plugin-contract.js';

export type PluginRegistrationAttempt =
  | { readonly ok: true; readonly pluginName: string }
  | { readonly ok: false; readonly code: 'invalid_plugin' | 'duplicate_plugin' };

type PluginPhase =
  'registered' | 'initialized' | 'started' | 'stopped' | 'quarantined' | 'destroyed';

interface PluginRecord {
  readonly plugin: RegisteredPlugin;
  phase: PluginPhase;
}

export class PluginRegistry {
  readonly #ordered: PluginRecord[] = [];
  readonly #names = new Set<string>();

  public register(input: unknown): PluginRegistrationAttempt {
    const snapshot = snapshotPlugin(input);
    if (!snapshot.ok) return { ok: false, code: 'invalid_plugin' };
    if (this.#names.has(snapshot.plugin.name)) {
      return { ok: false, code: 'duplicate_plugin' };
    }
    this.#names.add(snapshot.plugin.name);
    this.#ordered.push({ plugin: snapshot.plugin, phase: 'registered' });
    return { ok: true, pluginName: snapshot.plugin.name };
  }

  public async initializeAll(
    context: CorePluginContext,
    diagnostics: DiagnosticStore,
  ): Promise<number> {
    let diagnosticsAdded = 0;
    for (const record of this.#ordered) {
      if (record.phase !== 'registered') continue;
      try {
        await record.plugin.initialize(context);
        record.phase = 'initialized';
      } catch {
        record.phase = 'quarantined';
        diagnostics.add({
          code: 'plugin_initialize_failed',
          operation: 'initialize',
          pluginName: record.plugin.name,
        });
        diagnosticsAdded += 1;
      }
    }
    return diagnosticsAdded;
  }

  public async startAll(diagnostics: DiagnosticStore): Promise<number> {
    let diagnosticsAdded = 0;
    for (const record of this.#ordered) {
      if (record.phase !== 'initialized' && record.phase !== 'stopped') continue;
      try {
        await record.plugin.start();
        record.phase = 'started';
      } catch {
        record.phase = 'quarantined';
        diagnostics.add({
          code: 'plugin_start_failed',
          operation: 'start',
          pluginName: record.plugin.name,
        });
        diagnosticsAdded += 1;
      }
    }
    return diagnosticsAdded;
  }

  public async stopAll(diagnostics: DiagnosticStore): Promise<number> {
    let diagnosticsAdded = 0;
    for (const record of [...this.#ordered].reverse()) {
      if (record.phase !== 'started') continue;
      try {
        await record.plugin.stop();
        record.phase = 'stopped';
      } catch {
        record.phase = 'quarantined';
        diagnostics.add({
          code: 'plugin_stop_failed',
          operation: 'stop',
          pluginName: record.plugin.name,
        });
        diagnosticsAdded += 1;
      }
    }
    return diagnosticsAdded;
  }

  public async destroyAll(diagnostics: DiagnosticStore): Promise<number> {
    let diagnosticsAdded = 0;
    for (const record of [...this.#ordered].reverse()) {
      if (record.phase === 'destroyed') continue;
      try {
        await record.plugin.destroy();
      } catch {
        diagnostics.add({
          code: 'plugin_destroy_failed',
          operation: 'destroy',
          pluginName: record.plugin.name,
        });
        diagnosticsAdded += 1;
      } finally {
        record.phase = 'destroyed';
      }
    }
    return diagnosticsAdded;
  }
}
