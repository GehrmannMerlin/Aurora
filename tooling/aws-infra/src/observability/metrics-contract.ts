/**
 * OPS-06 runtime metrics + logging contract (Backend Design §14; 测试/部署设计 §12.1).
 *
 * Pure contract module — no AWS calls. Freezes the platform-run operational
 * metric namespace/names/dimensions and the structured-logging field rules.
 *
 * - `Aurora/Operational` custom metrics (Processing.*, Worker.*, Deployment.*,
 *   Ingestion.Availability) are emitted by the apps (`requires-app-emitter`);
 *   `Aurora/Ingestion/ErrorCount` is a CloudWatch Logs metric filter over the
 *   ingestion-api log group; RDS/ECS natives are wired in the stack.
 * - Log/metric labels must never carry passwords, cookies, tokens, full
 *   emails, request/response bodies, Source Maps, full URL queries or
 *   high-cardinality user context (测试/部署设计 §12.1).
 */

export const OPERATIONAL_NAMESPACE = 'Aurora/Operational';

export type MetricSeverity = 'P0' | 'P1' | 'P2';

export type MetricSource = 'app-emitter' | 'logs-metric-filter' | 'cloudwatch-native';

export type MetricUnit = 'Seconds' | 'Count' | 'Percent';

export interface OperationalMetric {
  readonly name: string;
  readonly unit: MetricUnit;
  readonly dimensions: readonly string[];
  readonly source: MetricSource;
  readonly description: string;
}

const VALID_UNITS: readonly MetricUnit[] = ['Seconds', 'Count', 'Percent'];
const VALID_SOURCES: readonly MetricSource[] = [
  'app-emitter',
  'logs-metric-filter',
  'cloudwatch-native',
];
const FORBIDDEN_DIMENSIONS: readonly string[] = [
  'password',
  'authorization',
  'cookie',
  'token',
  'email',
  'requestBody',
  'responseBody',
  'sourceMap',
  'fullUrl',
];

export const OPERATIONAL_METRICS: readonly OperationalMetric[] = Object.freeze([
  {
    name: 'Ingestion.Availability',
    unit: 'Percent',
    dimensions: ['environment'],
    source: 'app-emitter',
    description: 'fraction of valid requests acknowledged successfully (SLO numerator)',
  },
  {
    name: 'Processing.LagSeconds',
    unit: 'Seconds',
    dimensions: ['environment'],
    source: 'app-emitter',
    description: 'age of the oldest accepted-not-yet-queryable event (freshness SLO)',
  },
  {
    name: 'Processing.DeadLettered',
    unit: 'Count',
    dimensions: ['environment'],
    source: 'app-emitter',
    description: 'events moved to dead-letter (retry budget exhausted / invalid)',
  },
  {
    name: 'Worker.FailureCount',
    unit: 'Count',
    dimensions: ['environment', 'service'],
    source: 'app-emitter',
    description: 'worker processing failures in the window',
  },
  {
    name: 'Deployment.Failed',
    unit: 'Count',
    dimensions: ['environment', 'service'],
    source: 'cloudwatch-native',
    description: 'ECS deployment circuit-breaker rollback events',
  },
  {
    name: 'Ingestion.ErrorCount',
    unit: 'Count',
    dimensions: [],
    source: 'logs-metric-filter',
    description:
      'error-level ingestion-api log entries (Logs metric filter; CDK MetricFilter emits without dimensions)',
  },
]);

export function validateOperationalMetric(metric: OperationalMetric): void {
  if (metric.name.trim() === '') {
    throw new Error('ops_metric_invalid_name: metric name must not be empty');
  }
  if (!VALID_UNITS.includes(metric.unit)) {
    throw new Error(`ops_metric_invalid_unit: ${metric.unit}`);
  }
  if (!VALID_SOURCES.includes(metric.source)) {
    throw new Error(`ops_metric_invalid_source: ${metric.source}`);
  }
  for (const dimension of metric.dimensions) {
    if (FORBIDDEN_DIMENSIONS.includes(dimension)) {
      throw new Error(`ops_metric_forbidden_dimension: ${dimension}`);
    }
  }
}

export interface LogFieldContract {
  readonly requiredFields: readonly string[];
  readonly forbiddenFields: readonly string[];
}

export const LOG_FIELD_CONTRACT: LogFieldContract = Object.freeze({
  requiredFields: Object.freeze(['timestamp', 'level', 'requestId', 'operation']),
  forbiddenFields: Object.freeze([
    'password',
    'authorization',
    'cookie',
    'token',
    'email',
    'requestBody',
    'responseBody',
    'sourceMap',
    'fullUrl',
  ]),
});

export function assertSafeLogField(field: string): void {
  if (LOG_FIELD_CONTRACT.forbiddenFields.includes(field)) {
    throw new Error(`ops_forbidden_log_field: ${field} must never appear in logs or metric labels`);
  }
}
