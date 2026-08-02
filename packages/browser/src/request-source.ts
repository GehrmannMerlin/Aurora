export const BrowserRequestMechanism = Object.freeze({
  Fetch: 'fetch',
  XmlHttpRequest: 'xhr',
} as const);

export type BrowserRequestMechanism =
  (typeof BrowserRequestMechanism)[keyof typeof BrowserRequestMechanism];

export const BrowserRequestOutcome = Object.freeze({
  Success: 'success',
  HttpError: 'http_error',
  NetworkError: 'network_error',
  Timeout: 'timeout',
  Canceled: 'canceled',
} as const);

export type BrowserRequestOutcome =
  (typeof BrowserRequestOutcome)[keyof typeof BrowserRequestOutcome];

export const BrowserRequestSourceEventType = Object.freeze({
  Fetch: 'fetch',
  Xhr: 'xhr',
} as const);

export type BrowserRequestSourceEventType =
  (typeof BrowserRequestSourceEventType)[keyof typeof BrowserRequestSourceEventType];

export interface BrowserFetchRequestSourceEvent {
  readonly mechanism: typeof BrowserRequestMechanism.Fetch;
  readonly method: string;
  readonly url: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: BrowserRequestOutcome;
  readonly statusCode: number | null;
}

export interface BrowserXhrRequestSourceEvent {
  readonly mechanism: typeof BrowserRequestMechanism.XmlHttpRequest;
  readonly method: string;
  readonly url: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: BrowserRequestOutcome;
  readonly statusCode: number | null;
}

export type BrowserRequestSourceEvent =
  BrowserFetchRequestSourceEvent | BrowserXhrRequestSourceEvent;

export type BrowserRequestSourceListener = (event: BrowserRequestSourceEvent) => void;

// --- package-internal fact-view helpers (not exported from the package root) ---

import { sanitizePageUrl } from './safe-access.js';

function isRecordLike(input: unknown): input is Record<string, unknown> {
  return (typeof input === 'object' && input !== null) || typeof input === 'function';
}

function readString(target: unknown, key: string): string | null {
  if (!isRecordLike(target)) return null;
  try {
    const value = Reflect.get(target, key);
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function readRequestMethod(input: unknown, init: unknown): string {
  const initMethod = readString(init, 'method');
  if (initMethod !== null) return initMethod;
  const requestMethod = readString(input, 'method');
  return requestMethod ?? 'GET';
}

export function readRequestUrl(input: unknown): string | null {
  if (typeof input === 'string') return sanitizePageUrl(input);
  if (!isRecordLike(input)) return null;
  const url = readString(input, 'url');
  if (url !== null) return sanitizePageUrl(url);
  const href = readString(input, 'href');
  return href === null ? null : sanitizePageUrl(href);
}

export function createFetchRequestSourceEvent(
  input: unknown,
  init: unknown,
  startedAt: number,
  durationMs: number,
  outcome: BrowserRequestOutcome,
  statusCode: number | null,
): BrowserFetchRequestSourceEvent | null {
  const url = readRequestUrl(input);
  if (url === null) return null;
  return Object.freeze({
    mechanism: BrowserRequestMechanism.Fetch,
    method: readRequestMethod(input, init),
    url,
    startedAt,
    durationMs,
    outcome,
    statusCode,
  });
}

export function createXhrRequestSourceEvent(
  method: string | null,
  urlInput: unknown,
  startedAt: number,
  durationMs: number,
  outcome: BrowserRequestOutcome,
  statusCode: number | null,
): BrowserXhrRequestSourceEvent | null {
  const url = typeof urlInput === 'string' ? sanitizePageUrl(urlInput) : null;
  if (url === null || method === null) return null;
  return Object.freeze({
    mechanism: BrowserRequestMechanism.XmlHttpRequest,
    method,
    url,
    startedAt,
    durationMs,
    outcome,
    statusCode,
  });
}
