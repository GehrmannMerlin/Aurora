import { arr, enum_, obj, rec, str } from './schema.js';

export const ROUTE_TARGET_IDS = [
  'auth.register',
  'auth.verify-email',
  'auth.verify-email-confirm',
  'auth.login',
  'auth.forgot-password',
  'auth.reset-password',
  'invitation.accept',
  'account.security',
  'workspace.home',
  'organization.project-create',
  'organization.members',
  'organization.settings',
  'organization.usage',
  'organization.tokens',
  'organization.audit',
  'organization.trash',
  'project.onboarding',
  'project.overview',
  'project.issues',
  'project.issue-detail',
  'project.requests',
  'project.performance',
  'project.data-status',
  'project.releases',
  'project.release-detail',
  'project.source-maps',
  'project.alerts',
  'project.alert-rule-create',
  'project.alert-rule-edit',
  'project.alert-instance-detail',
  'project.access',
  'project.client-keys',
  'project.settings',
  'project.lifecycle',
  'account.notifications',
  'platform.resource-policies',
] as const;

export type RouteTargetId = (typeof ROUTE_TARGET_IDS)[number];

export const routeTargetId = enum_(ROUTE_TARGET_IDS, { openEnum: false });

export const routeTarget = obj({
  routeId: routeTargetId,
  pathParams: rec(str(1, 256)),
  query: rec(str(1, 512)),
});

export const navigationTargets = arr(routeTarget, 0, 20);
