export const PLATFORM_CONTRACT_VERSION = 'v1' as const;
export type PlatformContractVersion = typeof PLATFORM_CONTRACT_VERSION;

export * from './common/schema.js';
export * from './common/identifiers.js';
export * from './common/time.js';
