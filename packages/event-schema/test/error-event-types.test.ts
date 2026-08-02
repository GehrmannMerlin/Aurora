import { describe, expect, it } from 'vitest';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  PromiseRejectionReasonKind,
} from '@aurora/event-schema';

describe('error event public constants', () => {
  it('exposes exactly three approved error categories', () => {
    expect(ErrorCategory).toEqual({
      JavaScript: 'javascript',
      UnhandledRejection: 'unhandled_rejection',
      Resource: 'resource',
    });
  });

  it('exposes exactly three Promise reason kinds', () => {
    expect(PromiseRejectionReasonKind).toEqual({
      Error: 'error',
      String: 'string',
      NonStandard: 'non_standard',
    });
  });

  it('exposes only the four approved static resource types', () => {
    expect(ErrorResourceType).toEqual({
      Script: 'script',
      Stylesheet: 'stylesheet',
      Image: 'image',
      Font: 'font',
    });
  });

  it('exposes every exact error-event limit', () => {
    expect(ERROR_EVENT_LIMITS).toEqual({
      maxErrorNameLength: 128,
      maxErrorMessageLength: 2048,
      maxStackLength: 4096,
      maxResourceUrlLength: 2048,
      maxRejectionStringLength: 2048,
    });
  });
});
