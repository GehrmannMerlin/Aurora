import type { RouteTargetId } from '@aurora/platform-contract';

export const ORG_SIDEBAR_ENTRIES: readonly RouteTargetId[] = [
  'organization.members',
  'organization.settings',
  'organization.usage',
  'organization.tokens',
  'organization.audit',
  'organization.trash',
];

export const PROJECT_SIDEBAR_ENTRIES: readonly RouteTargetId[] = [
  'project.onboarding',
  'project.overview',
  'project.issues',
  'project.requests',
  'project.performance',
  'project.data-status',
  'project.releases',
  'project.alerts',
  'project.access',
  'project.client-keys',
  'project.settings',
];
