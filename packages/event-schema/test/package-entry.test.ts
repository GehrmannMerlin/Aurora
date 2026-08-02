import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function importFromPackage(specifier: string) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const module = await import(${JSON.stringify(specifier)}); console.log(Object.keys(module).sort().join(','));`,
    ],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  );
}

describe('built package entries', () => {
  it('loads the declared root entry', () => {
    const result = importFromPackage('@aurora/event-schema');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('parseEventEnvelope');
    expect(result.stdout).toContain('CURRENT_PROTOCOL_VERSION');
    expect(result.stdout).toContain('ErrorCategory');
    expect(result.stdout).toContain('ErrorResourceType');
    expect(result.stdout).toContain('PromiseRejectionReasonKind');
    expect(result.stdout).toContain('ERROR_EVENT_LIMITS');
    expect(result.stdout).toContain('parseErrorEventBody');
    expect(result.stdout).toContain('parseErrorEventEnvelope');
    expect(result.stdout).toContain('parseRequestEventBody');
    expect(result.stdout).toContain('parseRequestEventEnvelope');
    expect(result.stdout).toContain('RequestMethod');
    expect(result.stdout).toContain('RequestOutcome');
    expect(result.stdout).toContain('REQUEST_EVENT_LIMITS');
    expect(result.stdout).toContain('PerformanceMetricCategory');
    expect(result.stdout).toContain('PerformanceMetricName');
    expect(result.stdout).toContain('PerformanceMetricUnit');
    expect(result.stdout).toContain('PERFORMANCE_EVENT_LIMITS');
    expect(result.stdout).toContain('parsePerformanceEventBody');
    expect(result.stdout).toContain('parsePerformanceEventEnvelope');
    expect(result.stdout).toContain('BATCH_EVENT_LIMITS');
    expect(result.stdout).toContain('IngestionReceiptState');
    expect(result.stdout).toContain('IngestionErrorCode');
    expect(result.stdout).toContain('parseIngestionBatchRequest');
    expect(result.stdout).toContain('parseIngestionRequestReceipt');
    expect(result.stdout).toContain('parseIngestionEventReceipt');
  });

  it('loads the declared contract-testkit entry', () => {
    const result = importFromPackage('@aurora/event-schema/contract-testkit');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('validEventEnvelopeSamples');
    expect(result.stdout).toContain('invalidEventEnvelopeSamples');
    expect(result.stdout).toContain('boundaryEventEnvelopeSamples');
    expect(result.stdout).toContain('validErrorEventSamples');
    expect(result.stdout).toContain('invalidErrorEventSamples');
    expect(result.stdout).toContain('boundaryErrorEventSamples');
    expect(result.stdout).toContain('validRequestEventSamples');
    expect(result.stdout).toContain('invalidRequestEventSamples');
    expect(result.stdout).toContain('boundaryRequestEventSamples');
    expect(result.stdout).toContain('validPerformanceEventSamples');
    expect(result.stdout).toContain('invalidPerformanceEventSamples');
    expect(result.stdout).toContain('boundaryPerformanceEventSamples');
    expect(result.stdout).toContain('validIngestionBatchRequestSamples');
    expect(result.stdout).toContain('invalidIngestionBatchRequestSamples');
    expect(result.stdout).toContain('boundaryIngestionBatchRequestSamples');
    expect(result.stdout).toContain('validIngestionRequestReceiptSamples');
    expect(result.stdout).toContain('invalidIngestionRequestReceiptSamples');
    expect(result.stdout).toContain('boundaryIngestionRequestReceiptSamples');
  });

  it('rejects private and unexported paths', () => {
    for (const specifier of [
      '@aurora/event-schema/src/index.js',
      '@aurora/event-schema/internal/parser.js',
      '@aurora/event-schema/value-boundaries',
      '@aurora/event-schema/error-event-body',
      '@aurora/event-schema/error-event-envelope',
      '@aurora/event-schema/resource-error-event',
      '@aurora/event-schema/request-event-body',
      '@aurora/event-schema/request-event-envelope',
      '@aurora/event-schema/request-event-types',
      '@aurora/event-schema/performance-event-body',
      '@aurora/event-schema/performance-event-envelope',
      '@aurora/event-schema/performance-event-types',
      '@aurora/event-schema/ingestion-types',
      '@aurora/event-schema/ingestion-batch-request',
      '@aurora/event-schema/ingestion-request-receipt',
      '@aurora/event-schema/field-validation',
      '@aurora/event-schema/safe-url',
    ]) {
      const result = importFromPackage(specifier);
      expect(result.status, specifier).not.toBe(0);
      expect(result.stdout, specifier).toBe('');
      expect(result.stderr, specifier).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  });
});
