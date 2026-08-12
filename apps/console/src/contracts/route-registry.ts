import type { Component } from 'vue';
import { z } from 'zod';
import type { RouteTargetId } from '@aurora/platform-contract';
import type { ResolveResult, RouteEntry } from './route-types.js';

const emptyParams = z.object({});
const orgParams = z.object({ organizationId: z.string().min(1) });
const projectParams = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});
const issueParams = projectParams.extend({ issueId: z.string().min(1) });
const releaseParams = projectParams.extend({ releaseId: z.string().min(1) });
const sourceMapParams = projectParams.extend({ releaseId: z.string().min(1) });
const ruleParams = projectParams.extend({ ruleId: z.string().min(1) });
const instanceParams = projectParams.extend({ instanceId: z.string().min(1) });
const anyQuery = z.record(z.string(), z.string());

const unavailable = (): Promise<Component> => import('../components/pages/UnavailableView.vue');
const workspaceHome = (): Promise<Component> => import('../views/workspace/WorkspaceHomeView.vue');
const projectOnboardingView = (): Promise<Component> =>
  import('../views/project/ProjectOnboardingView.vue');
const projectOverviewView = (): Promise<Component> =>
  import('../views/project/ProjectOverviewView.vue');
const projectDataStatusView = (): Promise<Component> =>
  import('../views/project/ProjectDataStatusView.vue');
const projectIssuesView = (): Promise<Component> =>
  import('../views/project/ProjectIssuesView.vue');
const projectIssueDetailView = (): Promise<Component> =>
  import('../views/project/ProjectIssueDetailView.vue');
const projectRequestsView = (): Promise<Component> =>
  import('../views/project/ProjectRequestsView.vue');
const projectPerformanceView = (): Promise<Component> =>
  import('../views/project/ProjectPerformanceView.vue');
const projectReleasesView = (): Promise<Component> =>
  import('../views/project/ProjectReleasesView.vue');
const projectReleaseDetailView = (): Promise<Component> =>
  import('../views/project/ProjectReleaseDetailView.vue');
const projectSourceMapsView = (): Promise<Component> =>
  import('../views/project/ProjectSourceMapsView.vue');
const projectAlertsView = (): Promise<Component> =>
  import('../views/project/ProjectAlertsView.vue');
const projectAlertRuleFormView = (): Promise<Component> =>
  import('../views/project/ProjectAlertRuleFormView.vue');
const projectAlertInstanceDetailView = (): Promise<Component> =>
  import('../views/project/ProjectAlertInstanceDetailView.vue');
const projectAccessView = (): Promise<Component> =>
  import('../views/project/ProjectAccessView.vue');
const projectClientKeysView = (): Promise<Component> =>
  import('../views/project/ProjectClientKeysView.vue');
const projectSettingsView = (): Promise<Component> =>
  import('../views/project/ProjectSettingsView.vue');
const projectLifecycleView = (): Promise<Component> =>
  import('../views/project/ProjectLifecycleView.vue');
const usageView = (): Promise<Component> => import('../views/organization/UsageView.vue');
const projectCreateView = (): Promise<Component> =>
  import('../views/organization/ProjectCreateView.vue');
const membersView = (): Promise<Component> => import('../views/organization/MembersView.vue');
const settingsView = (): Promise<Component> => import('../views/organization/SettingsView.vue');
const tokensView = (): Promise<Component> => import('../views/organization/TokensView.vue');
const auditView = (): Promise<Component> => import('../views/organization/AuditView.vue');
const trashView = (): Promise<Component> => import('../views/organization/TrashView.vue');
const registerView = (): Promise<Component> => import('../views/auth/RegisterView.vue');
const verifyEmailView = (): Promise<Component> => import('../views/auth/VerifyEmailView.vue');
const verifyEmailConfirmView = (): Promise<Component> =>
  import('../views/auth/VerifyEmailConfirmView.vue');
const loginView = (): Promise<Component> => import('../views/auth/LoginView.vue');
const forgotPasswordView = (): Promise<Component> => import('../views/auth/ForgotPasswordView.vue');
const resetPasswordView = (): Promise<Component> => import('../views/auth/ResetPasswordView.vue');
const invitationAcceptView = (): Promise<Component> =>
  import('../views/auth/InvitationAcceptView.vue');
const accountSecurityView = (): Promise<Component> =>
  import('../views/account/AccountSecurityView.vue');
const deletionCancelView = (): Promise<Component> =>
  import('../views/account/DeletionCancelView.vue');
const deletionConfirmView = (): Promise<Component> =>
  import('../views/account/DeletionConfirmView.vue');

export const ROUTE_REGISTRY: readonly RouteEntry[] = [
  {
    routeId: 'auth.register',
    path: '/register',
    scope: 'public',
    label: '注册',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: registerView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'auth.verify-email',
    path: '/verify-email',
    scope: 'public',
    label: '邮箱验证',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: verifyEmailView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'auth.verify-email-confirm',
    path: '/verify-email/confirm',
    scope: 'public',
    label: '确认邮箱验证',
    parent: 'auth.verify-email',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: verifyEmailConfirmView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'auth.login',
    path: '/login',
    scope: 'public',
    label: '登录',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: loginView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'auth.forgot-password',
    path: '/forgot-password',
    scope: 'public',
    label: '忘记密码',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: forgotPasswordView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'auth.reset-password',
    path: '/reset-password',
    scope: 'public',
    label: '重置密码',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: resetPasswordView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'invitation.accept',
    path: '/invitations/accept',
    scope: 'public',
    label: '接受邀请',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: invitationAcceptView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'account.security',
    path: '/account/security',
    scope: 'account',
    label: '账号安全',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: accountSecurityView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'account.deletion-cancel',
    path: '/account/deletion-cancel',
    scope: 'public',
    label: '撤销账号注销',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: deletionCancelView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'account.deletion-confirm',
    path: '/account/deletion-confirm',
    scope: 'public',
    label: '注销账号确认',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: deletionConfirmView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'workspace.home',
    path: '/workspace',
    scope: 'workspace',
    label: '工作空间',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: workspaceHome,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'organization.project-create',
    path: '/organizations/:organizationId/projects/new',
    scope: 'organization',
    label: '创建项目',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: projectCreateView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'organization.members',
    path: '/organizations/:organizationId/members',
    scope: 'organization',
    label: '成员',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: membersView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'organization.settings',
    path: '/organizations/:organizationId/settings',
    scope: 'organization',
    label: '设置',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: settingsView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'organization.usage',
    path: '/organizations/:organizationId/usage',
    scope: 'organization',
    label: '用量',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: usageView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'organization.tokens',
    path: '/organizations/:organizationId/tokens',
    scope: 'organization',
    label: '令牌',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: tokensView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'organization.audit',
    path: '/organizations/:organizationId/audit',
    scope: 'organization',
    label: '审计',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: auditView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'organization.trash',
    path: '/organizations/:organizationId/trash',
    scope: 'organization',
    label: '回收站',
    paramsSchema: orgParams,
    querySchema: anyQuery,
    lazy: trashView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'project.onboarding',
    path: '/organizations/:organizationId/projects/:projectId/onboarding',
    scope: 'project',
    label: '接入',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: projectOnboardingView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'project.overview',
    path: '/organizations/:organizationId/projects/:projectId/overview',
    scope: 'project',
    label: '概览',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: projectOverviewView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'project.issues',
    path: '/organizations/:organizationId/projects/:projectId/issues',
    scope: 'project',
    label: '问题',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: projectIssuesView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'project.issue-detail',
    path: '/organizations/:organizationId/projects/:projectId/issues/:issueId',
    scope: 'project',
    label: '问题详情',
    parent: 'project.issues',
    paramsSchema: issueParams,
    querySchema: anyQuery,
    lazy: projectIssueDetailView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'project.requests',
    path: '/organizations/:organizationId/projects/:projectId/requests',
    scope: 'project',
    label: '请求',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: projectRequestsView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'project.performance',
    path: '/organizations/:organizationId/projects/:projectId/performance',
    scope: 'project',
    label: '性能',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: projectPerformanceView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'project.data-status',
    path: '/organizations/:organizationId/projects/:projectId/data-status',
    scope: 'project',
    label: '数据状态',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: projectDataStatusView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'project.releases',
    path: '/organizations/:organizationId/projects/:projectId/releases',
    scope: 'project',
    label: '发布',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: projectReleasesView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'project.release-detail',
    path: '/organizations/:organizationId/projects/:projectId/releases/:releaseId',
    scope: 'project',
    label: '发布详情',
    parent: 'project.releases',
    paramsSchema: releaseParams,
    querySchema: anyQuery,
    lazy: projectReleaseDetailView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'project.source-maps',
    path: '/organizations/:organizationId/projects/:projectId/releases/:releaseId/source-maps',
    scope: 'project',
    label: 'Source Map',
    parent: 'project.release-detail',
    paramsSchema: sourceMapParams,
    querySchema: anyQuery,
    lazy: projectSourceMapsView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'project.alerts',
    path: '/organizations/:organizationId/projects/:projectId/alerts',
    scope: 'project',
    label: '告警',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: projectAlertsView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'project.alert-rule-create',
    path: '/organizations/:organizationId/projects/:projectId/alerts/rules/new',
    scope: 'project',
    label: '新建告警规则',
    parent: 'project.alerts',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: projectAlertRuleFormView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'project.alert-rule-edit',
    path: '/organizations/:organizationId/projects/:projectId/alerts/rules/:ruleId/edit',
    scope: 'project',
    label: '编辑告警规则',
    parent: 'project.alerts',
    paramsSchema: ruleParams,
    querySchema: anyQuery,
    lazy: projectAlertRuleFormView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'project.alert-instance-detail',
    path: '/organizations/:organizationId/projects/:projectId/alerts/instances/:instanceId',
    scope: 'project',
    label: '告警实例详情',
    parent: 'project.alerts',
    paramsSchema: instanceParams,
    querySchema: anyQuery,
    lazy: projectAlertInstanceDetailView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'project.access',
    path: '/organizations/:organizationId/projects/:projectId/access',
    scope: 'project',
    label: '访问',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: projectAccessView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'project.client-keys',
    path: '/organizations/:organizationId/projects/:projectId/client-keys',
    scope: 'project',
    label: '客户端密钥',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: projectClientKeysView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'project.settings',
    path: '/organizations/:organizationId/projects/:projectId/settings',
    scope: 'project',
    label: '设置',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: projectSettingsView,
    menu: true,
    unavailableReason: null,
  },
  {
    routeId: 'project.lifecycle',
    path: '/organizations/:organizationId/projects/:projectId/settings/lifecycle',
    scope: 'project',
    label: '生命周期',
    parent: 'project.settings',
    paramsSchema: projectParams,
    querySchema: anyQuery,
    lazy: projectLifecycleView,
    menu: false,
    unavailableReason: null,
  },
  {
    routeId: 'account.notifications',
    path: '/notifications',
    scope: 'account',
    label: '通知',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: true,
    unavailableReason: 'capability-not-provided',
  },
  {
    routeId: 'platform.resource-policies',
    path: '/platform/resource-policies',
    scope: 'platform',
    label: '资源策略',
    paramsSchema: emptyParams,
    querySchema: anyQuery,
    lazy: unavailable,
    menu: false,
    unavailableReason: 'permission-unavailable',
  },
];

export const ROUTE_BY_ID = new Map(ROUTE_REGISTRY.map((entry) => [entry.routeId, entry]));

export function resolveRouteTarget(target: {
  routeId: RouteTargetId;
  pathParams: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string>>;
}): ResolveResult {
  const entry = ROUTE_BY_ID.get(target.routeId);
  if (entry === undefined) return { path: undefined, error: 'unknown-target' };
  const paramsResult = entry.paramsSchema.safeParse(target.pathParams);
  if (!paramsResult.success) return { path: undefined, error: 'invalid-params' };
  const queryResult = entry.querySchema.safeParse(target.query);
  if (!queryResult.success) return { path: undefined, error: 'invalid-params' };
  let path = entry.path;
  for (const [key, value] of Object.entries(
    paramsResult.data as Readonly<Record<string, string>>,
  )) {
    // split/join (not String.prototype.replace) so the encoded value is inserted
    // literally: a string replacement would interpret ECMAScript `$` patterns
    // and only replace the first occurrence.
    path = path.split(`:${key}`).join(encodeURIComponent(value));
  }
  const queryString = new URLSearchParams(target.query).toString();
  return { path: queryString.length === 0 ? path : `${path}?${queryString}` };
}
