/**
 * OPS-02 reference matrix contract (executable form).
 *
 * Every value here is copied verbatim from approved sources only:
 * - Browser engines / device classes: `docs/testing/test-strategy.md` §4
 * - Accessibility standard: `docs/testing/test-strategy.md` §4 + testing/deployment design §8.2 + visual language §8
 * - SDK performance budgets: `docs/testing/test-strategy.md` §5 + testing/deployment design §8.4
 * - CI placement: `docs/architecture/ci-quality-workflows.md` §4 + testing/deployment design §7
 *
 * Do NOT invent thresholds here. When an approved value changes, update this
 * module and its unit test together (see `test/matrix-contract.test.ts`).
 */

export const REFERENCE_MATRIX = Object.freeze({
  /** Playwright automation engines approved by test-strategy §4. */
  browsers: Object.freeze(['chromium', 'firefox', 'webkit']),
  /**
   * Minimal representative device/viewport set derived from the approved
   * device classes (desktop; iOS Safari / Android Chrome mobile). Not a
   * real-device promise — real Safari/mobile evidence stays TDR-GAP-06.
   */
  deviceViewports: Object.freeze({
    desktop: 'Desktop Chrome',
    mobileAndroid: 'Pixel 5',
    mobileIos: 'iPhone 14',
  }),
  /** WCAG 2.2 AA target; automated axe gate requires zero violations. */
  accessibility: Object.freeze({
    standard: 'WCAG 2.2 AA',
    autoViolationBudget: 0,
  }),
  /** Approved SDK runtime budgets (test-strategy §5 / testing-deploy §8.4). */
  performanceBudget: Object.freeze({
    initDesktopP95Ms: 20,
    initMobileP95Ms: 50,
    longTaskThresholdMs: 50,
    steadyStateHeapMiB: 5,
  }),
  /** Approved CI placement (test-strategy §3 / ci-quality-workflows §4). */
  ciPlacement: Object.freeze({
    pr: 'chromium-core',
    nightly: 'engines+devices+accessibility',
    release: '+performance-reference',
  }),
} as const);

export type ReferenceMatrix = typeof REFERENCE_MATRIX;
