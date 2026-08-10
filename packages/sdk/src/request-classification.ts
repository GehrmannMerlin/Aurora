import { parseRequestEventBody, RequestOutcome } from '@aurora/event-schema';
import type { SdkConfigSnapshot } from './configuration.js';
import type { SdkEventDraft } from './event-draft.js';
import { originMatchesAllowed, parseOrigin } from './origin.js';

export interface SdkRequestClassificationContext {
  readonly pageOrigin: string | null;
  readonly sdkReportUrls?: readonly string[];
}

export type SdkRequestClass = 'error' | 'slow' | 'normal';

export type SdkRequestDisallowReason = 'not_allowed_origin' | 'ignored_url' | 'sdk_report_url';

export interface SdkRequestClassificationResult {
  readonly ok: true;
  readonly class: SdkRequestClass;
  readonly normalizedUrl: string;
  readonly isError: boolean;
  readonly isSlow: boolean;
}

export interface SdkRequestDisallowed {
  readonly ok: false;
  readonly code: 'disallowed_request';
  readonly reason: SdkRequestDisallowReason;
}

export type SdkRequestDecision = SdkRequestClassificationResult | SdkRequestDisallowed;

const DIGIT_SEGMENT = /^\d+$/;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_SEGMENT = /^[0-9a-f]{16,}$/i;

export function isRequestAllowed(
  url: string,
  config: SdkConfigSnapshot,
  context: SdkRequestClassificationContext,
): { allowed: boolean; reason?: SdkRequestDisallowReason } {
  const lowerUrl = url.toLowerCase();
  for (const ignored of config.ignoredRequestUrls) {
    if (lowerUrl.includes(ignored.toLowerCase())) {
      return { allowed: false, reason: 'ignored_url' };
    }
  }
  const parsed = parseOrigin(url);
  if (parsed === null) return { allowed: false, reason: 'not_allowed_origin' };
  if (!(parsed.scheme === 'http' || parsed.scheme === 'https')) {
    return { allowed: false, reason: 'not_allowed_origin' };
  }
  for (const reportUrl of context.sdkReportUrls ?? []) {
    if (parsed.origin === reportUrl || lowerUrl.includes(reportUrl.toLowerCase())) {
      return { allowed: false, reason: 'sdk_report_url' };
    }
  }
  if (context.pageOrigin !== null && parsed.origin === context.pageOrigin && !config.excludeSameOriginRequests) {
    return { allowed: true };
  }
  for (const entry of config.allowedRequestOrigins) {
    if (originMatchesAllowed(parsed.origin, entry)) return { allowed: true };
  }
  return { allowed: false, reason: 'not_allowed_origin' };
}

function pathMatchesPattern(path: string, pattern: string): boolean {
  const pathParts = path.split('/').filter((part) => part.length > 0);
  const patternParts = pattern.split('/').filter((part) => part.length > 0);
  if (pathParts.length !== patternParts.length) return false;
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index] as string;
    const pathPart = pathParts[index] as string;
    if (patternPart.startsWith(':') && patternPart.length > 1) continue;
    if (patternPart !== pathPart) return false;
  }
  return true;
}

function normalizeSegment(segment: string): string {
  if (DIGIT_SEGMENT.test(segment)) return ':number';
  if (UUID_SEGMENT.test(segment)) return ':uuid';
  if (HASH_SEGMENT.test(segment)) return ':hash';
  return segment;
}

export function normalizeRequestPath(url: string, config: SdkConfigSnapshot): string {
  const parsed = parseOrigin(url);
  if (parsed === null) return url;
  const path = url.startsWith(parsed.origin) ? url.slice(parsed.origin.length) : url;
  const normalizedPath = path.length === 0 ? '/' : path;
  for (const rule of config.requestPathRules) {
    if (pathMatchesPattern(normalizedPath, rule.pattern)) {
      return `${parsed.origin}${rule.pattern}`;
    }
  }
  const segments = normalizedPath.split('/');
  const normalizedSegments = segments.map((segment) => (segment.length === 0 ? segment : normalizeSegment(segment)));
  return `${parsed.origin}${normalizedSegments.join('/')}`;
}

export function classifyRequestEvent(
  draft: SdkEventDraft,
  config: SdkConfigSnapshot,
  context: SdkRequestClassificationContext,
): SdkRequestDecision {
  if (draft.eventType !== 'request') {
    return { ok: false, code: 'disallowed_request', reason: 'not_allowed_origin' };
  }
  const parsed = parseRequestEventBody(draft.body);
  if (!parsed.success) {
    return { ok: false, code: 'disallowed_request', reason: 'not_allowed_origin' };
  }
  const body = parsed.data;
  const allowed = isRequestAllowed(body.url, config, context);
  if (!allowed.allowed) {
    return { ok: false, code: 'disallowed_request', reason: allowed.reason ?? 'not_allowed_origin' };
  }
  const isError =
    body.outcome === RequestOutcome.NetworkError ||
    body.statusCode === 429 ||
    (body.statusCode !== undefined && body.statusCode >= 500 && body.statusCode <= 599) ||
    (body.statusCode !== undefined && config.extraErrorStatusCodes.includes(body.statusCode));
  const isSlow = typeof body.durationMs === 'number' && body.durationMs >= config.slowRequestThreshold;
  const requestClass: SdkRequestClass = isError ? 'error' : isSlow ? 'slow' : 'normal';
  return Object.freeze({
    ok: true,
    class: requestClass,
    normalizedUrl: normalizeRequestPath(body.url, config),
    isError,
    isSlow,
  });
}
