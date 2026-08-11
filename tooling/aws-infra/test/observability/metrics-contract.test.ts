import { describe, expect, it } from 'vitest';
import {
  OPERATIONAL_METRICS,
  OPERATIONAL_NAMESPACE,
  assertSafeLogField,
  validateOperationalMetric,
  type OperationalMetric,
} from '../../src/observability/metrics-contract.js';

describe('operational metrics contract', () => {
  it('defines the Aurora/Operational namespace with the platform-run metrics', () => {
    expect(OPERATIONAL_NAMESPACE).toBe('Aurora/Operational');
    const names = OPERATIONAL_METRICS.map((metric) => metric.name);
    expect(names).toContain('Ingestion.Availability');
    expect(names).toContain('Processing.LagSeconds');
    expect(names).toContain('Processing.DeadLettered');
    expect(names).toContain('Worker.FailureCount');
    expect(names).toContain('Deployment.Failed');
    expect(names).toContain('Ingestion.ErrorCount');
  });

  it('validates every frozen metric definition', () => {
    for (const metric of OPERATIONAL_METRICS) {
      expect(() => {
        validateOperationalMetric(metric);
      }).not.toThrow();
    }
  });

  it('rejects a metric with an invalid unit', () => {
    const bad = {
      name: 'Bad.Metric',
      unit: 'Bytes',
      dimensions: ['environment'],
      source: 'app-emitter',
      description: 'x',
    } as unknown as OperationalMetric;
    expect(() => {
      validateOperationalMetric(bad);
    }).toThrow('ops_metric_invalid_unit');
  });

  it('rejects a metric that leaks a sensitive dimension', () => {
    const bad = {
      name: 'Bad.Metric',
      unit: 'Count',
      dimensions: ['environment', 'authorization'],
      source: 'app-emitter',
      description: 'x',
    } as OperationalMetric;
    expect(() => {
      validateOperationalMetric(bad);
    }).toThrow('ops_metric_forbidden_dimension');
  });

  it('rejects forbidden log fields (secrets / privacy)', () => {
    expect(() => {
      assertSafeLogField('requestId');
    }).not.toThrow();
    for (const field of ['password', 'authorization', 'requestBody', 'sourceMap']) {
      expect(() => {
        assertSafeLogField(field);
      }).toThrow('ops_forbidden_log_field');
    }
  });
});
