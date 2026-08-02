import type { BrowserEnvironment } from '@aurora/browser';
import {
  createPerformanceCapturePlugin,
  type PerformanceCaptureDiagnostic,
  type PerformanceCapturePlugin,
} from '../src/index.js';

declare const browser: BrowserEnvironment;
const plugin: PerformanceCapturePlugin = createPerformanceCapturePlugin(browser);
const diagnostics: readonly PerformanceCaptureDiagnostic[] = plugin.getDiagnostics();
void [plugin, diagnostics];
