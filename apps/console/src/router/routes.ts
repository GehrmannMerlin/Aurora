import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router';
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
        redirect: { name: 'workspace.home' },
        meta: { label: '工作空间', routeId: 'workspace.home', scope: 'workspace' },
      },
      ...ROUTE_REGISTRY.map((entry) => {
        const unavailable = entry.unavailableReason;
        return {
          path: entry.path.replace(/^\/+/, '') || '',
          name: entry.routeId,
          component: entry.lazy,
          ...(unavailable !== null
            ? {
                props: (route: RouteLocationNormalized) => ({
                  title: route.meta.label as string,
                  reason: unavailable,
                }),
              }
            : {}),
          meta: {
            label: entry.label,
            routeId: entry.routeId,
            scope: entry.scope,
            unavailableReason: entry.unavailableReason,
          },
        };
      }),
      {
        path: 'route-error',
        name: 'route-error',
        component: () => import('../components/pages/RouteErrorView.vue'),
        meta: { label: '页面加载失败', scope: 'public' },
      },
      {
        path: 'forbidden',
        name: 'forbidden',
        component: () => import('../components/pages/ForbiddenView.vue'),
        meta: { label: '无权限访问', scope: 'public' },
      },
      {
        path: ':pathMatch(.*)*',
        name: 'not-found',
        component: () => import('../components/pages/NotFoundView.vue'),
        meta: { label: '页面不存在', scope: 'public' },
      },
    ],
  },
];
