import type { RouteTargetId } from '@aurora/platform-contract';

export const ORG_SIDEBAR_ENTRIES: readonly RouteTargetId[] = [
  'workspace.home',
  'organization.members',
  'organization.settings',
  'organization.usage',
  'organization.tokens',
  'organization.audit',
  'organization.trash',
];

export const WORKSPACE_SIDEBAR_ENTRIES: readonly RouteTargetId[] = ['workspace.home'];

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
