import { describe, expect, expectTypeOf, it } from 'vitest';
import type { BrowserEnvironment } from '@aurora/browser';
import type { CorePlugin, CorePluginContext } from '@aurora/core';
import {
  ERROR_CAPTURE_PLUGIN_NAME,
  ErrorCaptureDiagnosticCode,
  ErrorCaptureDiagnosticOperation,
  createErrorCapturePlugin,
  type ErrorCaptureDiagnostic,
  type ErrorCapturePlugin,
} from '../src/index.js';

describe('error capture public contract', () => {
  it('exports the exact stable runtime constants', () => {
    expect(ERROR_CAPTURE_PLUGIN_NAME).toBe('error-capture');
    expect(ErrorCaptureDiagnosticCode).toEqual({
      InvalidLifecycleCall: 'invalid_lifecycle_call',
      InvalidPluginContext: 'invalid_plugin_context',
      BrowserSubscriptionFailed: 'browser_subscription_failed',
      BrowserUnsubscribeFailed: 'browser_unsubscribe_failed',
      UnsupportedSource: 'unsupported_source',
      ErrorBodyRejected: 'error_body_rejected',
      EventSubmissionFailed: 'event_submission_failed',
      RecursiveCaptureBlocked: 'recursive_capture_blocked',
      InternalError: 'internal_error',
    });
    expect(ErrorCaptureDiagnosticOperation).toEqual({
      Initialize: 'initialize',
      Start: 'start',
      Stop: 'stop',
      Destroy: 'destroy',
      Convert: 'convert',
      Submit: 'submit',
      Notify: 'notify',
    });
    expect(Object.isFrozen(ErrorCaptureDiagnosticCode)).toBe(true);
    expect(Object.isFrozen(ErrorCaptureDiagnosticOperation)).toBe(true);
  });

  it('is exactly a CorePlugin plus frozen diagnostics', () => {
    expectTypeOf<ErrorCapturePlugin>().toExtend<CorePlugin>();
    expectTypeOf<ErrorCapturePlugin['initialize']>()
      .parameter(0)
      .toEqualTypeOf<CorePluginContext>();
    expectTypeOf<ErrorCapturePlugin['getDiagnostics']>().returns.toEqualTypeOf<
      readonly ErrorCaptureDiagnostic[]
    >();
    expectTypeOf(createErrorCapturePlugin).parameters.toEqualTypeOf<[BrowserEnvironment]>();
  });
});
