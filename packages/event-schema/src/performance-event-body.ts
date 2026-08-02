import {
  PERFORMANCE_EVENT_LIMITS,
  PerformanceMetricCategory,
  PerformanceMetricName,
  PerformanceMetricUnit,
  type PerformanceEventBodyParseResult,
} from './performance-event-types.js';
import {
  addValidationIssue,
  isPlainRecord,
  readRequiredField,
  rejectUnknownFields,
} from './field-validation.js';
import type { EventSchemaIssue } from './validation-issues.js';
import { validateBodyValue } from './value-boundaries.js';

const PERFORMANCE_BODY_FIELDS: ReadonlySet<string> = new Set([
  'metricCategory',
  'metricName',
  'value',
  'unit',
  'startedAt',
  'durationMs',
]);
const metricCategories: ReadonlySet<unknown> = new Set(Object.values(PerformanceMetricCategory));
const metricNames: ReadonlySet<unknown> = new Set(Object.values(PerformanceMetricName));
const metricUnits: ReadonlySet<unknown> = new Set(Object.values(PerformanceMetricUnit));

function unsafeBodyFailure(): PerformanceEventBodyParseResult {
  return {
    success: false,
    issues: [
      {
        code: 'invalid_type',
        path: ['body'],
        message: 'Performance event body could not be read safely',
      },
    ],
  };
}

function parseCategory(
  input: unknown,
  issues: EventSchemaIssue[],
): PerformanceMetricCategory | undefined {
  const path = ['body', 'metricCategory'] as const;
  if (typeof input !== 'string') {
    addValidationIssue(
      issues,
      'invalid_type',
      path,
      'Performance metric category must be a string',
    );
    return undefined;
  }
  if (!metricCategories.has(input)) {
    addValidationIssue(
      issues,
      'invalid_enum',
      path,
      'Performance metric category is not supported',
    );
    return undefined;
  }
  return PerformanceMetricCategory.Page;
}

function parseMetricName(
  input: unknown,
  issues: EventSchemaIssue[],
): PerformanceMetricName | undefined {
  const path = ['body', 'metricName'] as const;
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Performance metric name must be a string');
    return undefined;
  }
  if (!metricNames.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'Performance metric name is not supported');
    return undefined;
  }
  if (input === PerformanceMetricName.Lcp) return PerformanceMetricName.Lcp;
  if (input === PerformanceMetricName.Inp) return PerformanceMetricName.Inp;
  if (input === PerformanceMetricName.Cls) return PerformanceMetricName.Cls;
  return PerformanceMetricName.PageLoad;
}

function parseUnit(input: unknown, issues: EventSchemaIssue[]): PerformanceMetricUnit | undefined {
  const path = ['body', 'unit'] as const;
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Performance metric unit must be a string');
    return undefined;
  }
  if (!metricUnits.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'Performance metric unit is not supported');
    return undefined;
  }
  return input === PerformanceMetricUnit.Ratio
    ? PerformanceMetricUnit.Ratio
    : PerformanceMetricUnit.Millisecond;
}

function parseValue(
  input: unknown,
  unit: PerformanceMetricUnit | undefined,
  issues: EventSchemaIssue[],
): number | undefined {
  const path = ['body', 'value'] as const;
  if (typeof input !== 'number') {
    addValidationIssue(issues, 'invalid_type', path, 'Performance metric value must be a number');
    return undefined;
  }
  if (unit === PerformanceMetricUnit.Ratio) {
    if (!Number.isFinite(input) || input < 0 || input > PERFORMANCE_EVENT_LIMITS.maxRatioValue) {
      addValidationIssue(
        issues,
        'invalid_number',
        path,
        'Ratio value must be finite and between 0 and 1',
      );
      return undefined;
    }
    return input;
  }
  if (
    !Number.isSafeInteger(input) ||
    input < 0 ||
    input > PERFORMANCE_EVENT_LIMITS.maxValueSafeInteger
  ) {
    addValidationIssue(
      issues,
      'invalid_number',
      path,
      'Millisecond value must be a non-negative safe integer',
    );
    return undefined;
  }
  return input;
}

function parseStartedAt(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  const path = ['body', 'startedAt'] as const;
  if (typeof input !== 'number') {
    addValidationIssue(issues, 'invalid_type', path, 'startedAt must be a number');
    return undefined;
  }
  if (!Number.isSafeInteger(input) || input <= 0) {
    addValidationIssue(
      issues,
      'invalid_timestamp',
      path,
      'startedAt must be a positive safe integer in Unix epoch milliseconds',
    );
    return undefined;
  }
  return input;
}

function parseDurationMs(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  const path = ['body', 'durationMs'] as const;
  if (typeof input !== 'number') {
    addValidationIssue(issues, 'invalid_type', path, 'durationMs must be a number');
    return undefined;
  }
  if (!Number.isSafeInteger(input) || input < 0 || input > PERFORMANCE_EVENT_LIMITS.maxDurationMs) {
    addValidationIssue(
      issues,
      'invalid_number',
      path,
      'durationMs must be a safe integer between 0 and 86400000',
    );
    return undefined;
  }
  return input;
}

function parseBody(input: unknown): PerformanceEventBodyParseResult {
  const issues: EventSchemaIssue[] = [];
  validateBodyValue(input, issues);
  if (issues.length > 0) return { success: false, issues };
  if (!isPlainRecord(input)) {
    addValidationIssue(
      issues,
      'invalid_type',
      ['body'],
      'Performance event body must be a plain object',
    );
    return { success: false, issues };
  }
  rejectUnknownFields(input, PERFORMANCE_BODY_FIELDS, issues, ['body']);
  const categoryField = readRequiredField(input, 'metricCategory', issues, ['body']);
  const nameField = readRequiredField(input, 'metricName', issues, ['body']);
  const valueField = readRequiredField(input, 'value', issues, ['body']);
  const unitField = readRequiredField(input, 'unit', issues, ['body']);
  const startedAtField = readRequiredField(input, 'startedAt', issues, ['body']);
  const hasDurationMs = Object.prototype.hasOwnProperty.call(input, 'durationMs');
  const category = categoryField.found ? parseCategory(categoryField.value, issues) : undefined;
  const metricName = nameField.found ? parseMetricName(nameField.value, issues) : undefined;
  const unit = unitField.found ? parseUnit(unitField.value, issues) : undefined;
  const value = valueField.found ? parseValue(valueField.value, unit, issues) : undefined;
  const startedAt = startedAtField.found ? parseStartedAt(startedAtField.value, issues) : undefined;
  const durationMs = hasDurationMs ? parseDurationMs(input.durationMs, issues) : undefined;
  if (
    issues.length > 0 ||
    category === undefined ||
    metricName === undefined ||
    value === undefined ||
    unit === undefined ||
    startedAt === undefined ||
    (hasDurationMs && durationMs === undefined)
  ) {
    return { success: false, issues };
  }
  return {
    success: true,
    data: {
      metricCategory: category,
      metricName,
      value,
      unit,
      startedAt,
      ...(durationMs === undefined ? {} : { durationMs }),
    },
  };
}

export function parsePerformanceEventBody(input: unknown): PerformanceEventBodyParseResult {
  try {
    return parseBody(input);
  } catch {
    return unsafeBodyFailure();
  }
}
