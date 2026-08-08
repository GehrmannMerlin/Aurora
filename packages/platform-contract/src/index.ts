export const PLATFORM_CONTRACT_VERSION = 'v1' as const;
export type PlatformContractVersion = typeof PLATFORM_CONTRACT_VERSION;

export * from './common/schema.js';
export * from './common/identifiers.js';
export * from './common/time.js';
export * from './common/pagination.js';
export * from './common/query.js';
export * from './common/command.js';
export * from './common/operation.js';
export * from './common/problem-details.js';
export * from './common/section.js';
export * from './common/authorization.js';
export * from './common/navigation.js';
export * from './identity/session.js';
export * from './identity/navigation-context.js';
