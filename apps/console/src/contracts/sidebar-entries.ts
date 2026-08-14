import type { RouteTargetId } from '@aurora/platform-contract';

export interface SidebarGroup {
  readonly label: string;
  readonly routeIds: readonly RouteTargetId[];
}

export const ORG_SIDEBAR_GROUPS: readonly SidebarGroup[] = [
  { label: '组织', routeIds: ['organization.members', 'organization.settings'] },
  { label: '使用情况', routeIds: ['organization.usage', 'organization.tokens'] },
  { label: '治理', routeIds: ['organization.audit', 'organization.trash'] },
];

export const PROJECT_SIDEBAR_GROUPS: readonly SidebarGroup[] = [
  { label: '接入', routeIds: ['project.onboarding'] },
  {
    label: '观测',
    routeIds: [
      'project.overview',
      'project.issues',
      'project.requests',
      'project.performance',
      'project.data-status',
    ],
  },
  { label: '交付', routeIds: ['project.releases'] },
  { label: '告警', routeIds: ['project.alerts'] },
  { label: '治理', routeIds: ['project.access', 'project.client-keys', 'project.settings'] },
];

/** Compatibility projections for existing contract consumers. */
export const ORG_SIDEBAR_ENTRIES: readonly RouteTargetId[] = ORG_SIDEBAR_GROUPS.flatMap(
  (group) => group.routeIds,
);
export const PROJECT_SIDEBAR_ENTRIES: readonly RouteTargetId[] = PROJECT_SIDEBAR_GROUPS.flatMap(
  (group) => group.routeIds,
);
