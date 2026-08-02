import type { BrowserEnvironment } from '@aurora/browser';
import {
  createRequestCapturePlugin,
  type RequestCaptureDiagnostic,
  type RequestCapturePlugin,
} from '../src/index.js';

declare const browser: BrowserEnvironment;
const plugin: RequestCapturePlugin = createRequestCapturePlugin(browser);
const diagnostics: readonly RequestCaptureDiagnostic[] = plugin.getDiagnostics();
void [plugin, diagnostics];
