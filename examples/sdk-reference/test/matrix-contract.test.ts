import { describe, expect, it } from 'vitest';
import { REFERENCE_MATRIX } from '../src/matrix.js';

describe('OPS-02 reference matrix contract', () => {
  it('freezes the approved Playwright browser engines', () => {
    expect(REFERENCE_MATRIX.browsers).toEqual(['chromium', 'firefox', 'webkit']);
  });

  it('covers the approved device classes with a minimal representative set', () => {
    // Device classes come from test-strategy §4 (desktop; iOS Safari / Android Chrome).
    expect(REFERENCE_MATRIX.deviceViewports.desktop).toBe('Desktop Chrome');
    expect(REFERENCE_MATRIX.deviceViewports.mobileAndroid).toBe('Pixel 5');
    expect(REFERENCE_MATRIX.deviceViewports.mobileIos).toBe('iPhone 14');
  });

  it('freezes the approved WCAG 2.2 AA accessibility gate with zero auto violations', () => {
    expect(REFERENCE_MATRIX.accessibility.standard).toBe('WCAG 2.2 AA');
    expect(REFERENCE_MATRIX.accessibility.autoViolationBudget).toBe(0);
  });

  it('freezes the approved SDK performance budgets', () => {
    expect(REFERENCE_MATRIX.performanceBudget.initDesktopP95Ms).toBe(20);
    expect(REFERENCE_MATRIX.performanceBudget.initMobileP95Ms).toBe(50);
    expect(REFERENCE_MATRIX.performanceBudget.longTaskThresholdMs).toBe(50);
    expect(REFERENCE_MATRIX.performanceBudget.steadyStateHeapMiB).toBe(5);
  });

  it('freezes CI placement: PR = chromium core, nightly = engines+devices+a11y, release = +performance', () => {
    expect(REFERENCE_MATRIX.ciPlacement.pr).toBe('chromium-core');
    expect(REFERENCE_MATRIX.ciPlacement.nightly).toBe('engines+devices+accessibility');
    expect(REFERENCE_MATRIX.ciPlacement.release).toBe('+performance-reference');
  });
});
