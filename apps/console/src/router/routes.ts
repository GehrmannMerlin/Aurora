import type { RouteRecordRaw } from 'vue-router';
import { ROUTE_REGISTRY } from '../contracts/route-registry';
import AppShell from '../components/shell/AppShell.vue';

export const appRoutes: readonly RouteRecordRaw[] = [
  {
    path: '/',
    component: AppShell,
    children: [
      {
        path: '',
        name: 'root',
        component: () => import('../components/pages/WorkspaceHomeView.vue'),
        meta: { label: '工作空间', routeId: 'workspace.home', scope: 'workspace' },
      },
      ...ROUTE_REGISTRY.map((entry) => ({
        path: entry.path.replace(/^\/+/, '') || '',
        name: entry.routeId,
        component: entry.lazy,
        meta: { label: entry.label, routeId: entry.routeId, scope: entry.scope },
      })),
      {
        path: ':pathMatch(.*)*',
        name: 'not-found',
        component: () => import('../components/pages/NotFoundView.vue'),
        meta: { label: '页面不存在', scope: 'public' },
      },
    ],
  },
];
