export const CURRENT_PROTOCOL_VERSION = 1 as const;

export const SUPPORTED_PROTOCOL_VERSIONS = [CURRENT_PROTOCOL_VERSION] as const;

export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

export const EVENT_SCHEMA_LIMITS = {
  maxEventIdLength: 128,
  maxStringLength: 4096,
  maxArrayLength: 100,
  maxObjectKeys: 100,
  maxObjectDepth: 8,
  maxIssues: 50,
} as const;

export function isSupportedProtocolVersion(input: unknown): input is ProtocolVersion {
  return input === CURRENT_PROTOCOL_VERSION;
}
