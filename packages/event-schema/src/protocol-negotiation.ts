import { isSupportedProtocolVersion, type ProtocolVersion } from './constants.js';

export type ProtocolNegotiationCode = 'supported' | 'unsupported_version';

export interface ProtocolNegotiationSupported {
  readonly ok: true;
  readonly code: 'supported';
  readonly version: ProtocolVersion;
}

export interface ProtocolNegotiationUnsupported {
  readonly ok: false;
  readonly code: 'unsupported_version';
  readonly requestedVersion: unknown;
}

export type ProtocolNegotiationResult =
  ProtocolNegotiationSupported | ProtocolNegotiationUnsupported;

export function negotiateProtocolVersion(input: unknown): ProtocolNegotiationResult {
  if (isSupportedProtocolVersion(input)) {
    return Object.freeze({ ok: true, code: 'supported', version: input });
  }
  return Object.freeze({ ok: false, code: 'unsupported_version', requestedVersion: input });
}
