import { BrowserErrorSourceEventType } from '@aurora/browser';
import { ErrorCategory } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import { convertJavaScriptError } from '../src/javascript-error-converter.js';

describe('JavaScript error conversion', () => {
  it('copies a bounded Error descriptor without retaining the Error', () => {
    const error = new Error('Synthetic failure token=private');
    error.name = 'SyntheticError';
    const result = convertJavaScriptError({
      type: BrowserErrorSourceEventType.JavaScript,
      message: 'ignored',
      sourceUrl: 'https://app.example.test/main.js',
      error,
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        category: ErrorCategory.JavaScript,
        error: { name: 'SyntheticError', message: 'Synthetic failure token=[redacted]' },
      },
    });
    if (!result.success) throw new Error('conversion must pass');
    if (result.data.category !== ErrorCategory.JavaScript) {
      throw new Error('javascript body required');
    }
    expect(result.data.error).not.toBe(error);
  });

  it('uses the ErrorEvent message when no Error exists and removes URL suffixes', () => {
    const result = convertJavaScriptError({
      type: BrowserErrorSourceEventType.JavaScript,
      message: 'Failed at https://app.example.test/a.js?token=private#frame',
      sourceUrl: 'https://app.example.test/a.js',
      error: undefined,
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        error: { message: 'Failed at https://app.example.test/a.js' },
      },
    });
  });

  it('contains hostile getters and uses a stable fallback', () => {
    const hostile: unknown = Object.create(null, {
      message: {
        get(): never {
          throw new Error('authorization=private');
        },
      },
    });
    expect(
      convertJavaScriptError({
        type: BrowserErrorSourceEventType.JavaScript,
        message: null,
        sourceUrl: null,
        error: hostile,
      }),
    ).toMatchObject({
      success: true,
      data: { error: { message: 'Unknown JavaScript error' } },
    });
  });

  it('does not modify the source view or Error', () => {
    const error = new Error('Stable');
    const event = Object.freeze({
      type: BrowserErrorSourceEventType.JavaScript,
      message: 'Stable',
      sourceUrl: null,
      error,
    });
    const before = { name: error.name, message: error.message, stack: error.stack };
    convertJavaScriptError(event);
    expect({ name: error.name, message: error.message, stack: error.stack }).toEqual(before);
  });
});
