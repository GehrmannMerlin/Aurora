import {
  captureBrowserHost,
  detectBrowserCapabilities,
  type BrowserCapabilities,
} from './capabilities.js';
import { createDiagnosticStore, type BrowserDiagnostic } from './diagnostics.js';
import {
  createLifecycleManager,
  type BrowserDestroyResult,
  type BrowserLifecycleListener,
  type BrowserSubscribeResult,
} from './page-lifecycle.js';
import { readPageSnapshot, type BrowserPageSnapshot } from './page-snapshot.js';

export interface BrowserEnvironment {
  getCapabilities(): BrowserCapabilities;
  readPageSnapshot(): BrowserPageSnapshot;
  subscribePageLifecycle(listener: BrowserLifecycleListener): BrowserSubscribeResult;
  destroy(): BrowserDestroyResult;
  getDiagnostics(): readonly BrowserDiagnostic[];
}

export function createBrowserEnvironment(): BrowserEnvironment {
  const diagnostics = createDiagnosticStore();
  const host = captureBrowserHost(diagnostics);
  const capabilities = detectBrowserCapabilities(host, diagnostics);
  const lifecycle = createLifecycleManager(host, diagnostics);
  return Object.freeze({
    getCapabilities: (): BrowserCapabilities => capabilities,
    readPageSnapshot: (): BrowserPageSnapshot => readPageSnapshot(host, diagnostics),
    subscribePageLifecycle: (listener: BrowserLifecycleListener): BrowserSubscribeResult =>
      lifecycle.subscribe(listener),
    destroy: (): BrowserDestroyResult => lifecycle.destroy(),
    getDiagnostics: (): readonly BrowserDiagnostic[] => diagnostics.getDiagnostics(),
  });
}
