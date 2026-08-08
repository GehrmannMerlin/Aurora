import { auroraProblem } from '@aurora/platform-contract';

export type ProblemCode =
  | 'structural_error'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'field_validation'
  | 'business_validation'
  | 'idempotency_conflict'
  | 'version_conflict'
  | 'state_machine_conflict'
  | 'rate_limited'
  | 'processing'
  | 'downstream_partial_failure'
  | 'authority_unavailable'
  | 'network_error';

export class ApiError extends Error {
  readonly code: ProblemCode;
  readonly status: number | null;
  readonly requestId?: string;
  readonly retryAfter?: number;

  constructor(options: {
    code: ProblemCode;
    message: string;
    status?: number | null;
    requestId?: string | undefined;
    retryAfter?: number | undefined;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status ?? null;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (options.retryAfter !== undefined) this.retryAfter = options.retryAfter;
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set([
  'structural_error',
  'authentication',
  'authorization',
  'not_found',
  'field_validation',
  'business_validation',
  'idempotency_conflict',
  'version_conflict',
  'state_machine_conflict',
  'rate_limited',
  'processing',
  'downstream_partial_failure',
  'authority_unavailable',
]);

// `SchemaDef.zod` erases to the `z.ZodType` base, so `safeParse` data is `unknown`; the
// fields below are the subset the request layer reads after the schema validated them.
type NormalizedProblem = {
  code: string;
  title: string;
  status: number;
  requestId?: string;
  retryAfter?: number;
};

export function normalizeProblem(raw: unknown, status: number): ApiError {
  const parsed = auroraProblem.zod.safeParse(raw);
  const problem = parsed.success ? (parsed.data as NormalizedProblem) : undefined;
  if (problem === undefined || !KNOWN_CODES.has(problem.code)) {
    return new ApiError({
      code: 'structural_error',
      status,
      message: 'Response does not match the public contract.',
    });
  }
  return new ApiError({
    code: problem.code as ProblemCode,
    status: problem.status,
    message: problem.title,
    requestId: problem.requestId,
    retryAfter: problem.retryAfter,
  });
}
