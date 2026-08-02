import type { BrowserEnvironment } from '@aurora/browser';
import {
  createErrorCapturePlugin,
  type ErrorCaptureDiagnostic,
  type ErrorCapturePlugin,
} from '../src/index.js';

declare const browser: BrowserEnvironment;
const plugin: ErrorCapturePlugin = createErrorCapturePlugin(browser);
const diagnostics: readonly ErrorCaptureDiagnostic[] = plugin.getDiagnostics();
void [plugin, diagnostics];
