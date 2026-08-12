<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { resolveRouteTarget } from '../../contracts/route-registry';
import { useNavigationStore } from '../../stores/navigation';
import { useSessionStore } from '../../stores/session';
import AppLink from '../aurora/AppLink.vue';
import ScopeSwitcher from './ScopeSwitcher.vue';

const session = useSessionStore();
const navigation = useNavigationStore();
const { status: sessionStatus } = storeToRefs(session);
const { organizations, currentOrganizationId, unreadCount } = storeToRefs(navigation);

const authenticated = computed(() => sessionStatus.value === 'authenticated');
const orgLabel = computed(() => {
  if (!authenticated.value) return '未登录';
  const org = organizations.value.find(
    (candidate) => candidate.organizationId === currentOrganizationId.value,
  );
  return org?.name ?? '未选择';
});

/** PLT-09 D1 unread badge: only an authoritative available count > 0 is shown. */
const unreadBadge = computed(() => {
  if (unreadCount.value.status !== 'available') return null;
  if (unreadCount.value.value === undefined || unreadCount.value.value <= 0) return null;
  return String(unreadCount.value.value);
});

function hrefFor(routeId: string): string {
  return (
    resolveRouteTarget({ routeId: routeId as never, pathParams: {}, query: {} }).path ??
    '/not-found'
  );
}
</script>

<template>
  <header class="au-topbar">
    <AppLink :to="hrefFor('workspace.home')" class="au-brand" label="Aurora" />
    <nav class="au-topnav" aria-label="顶栏导航">
      <AppLink :to="hrefFor('workspace.home')" label="工作空间" />
      <ScopeSwitcher />
      <span class="au-scope-chip">{{ orgLabel }}</span>
      <AppLink :to="hrefFor('account.notifications')" aria-label="通知">
        通知
        <span
          v-if="unreadBadge !== null"
          class="au-unread-badge"
          data-testid="topbar-unread-badge"
          aria-hidden="true"
          >{{ unreadBadge }}</span
        >
      </AppLink>
      <AppLink :to="hrefFor('account.security')" label="账号安全" />
    </nav>
  </header>
</template>

<style scoped>
.au-topbar {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  height: var(--nav-height);
  padding: 0 var(--space-5);
  background-color: var(--color-topbar-bg);
  color: var(--color-topbar-fg);
}
.au-topnav {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.au-topnav :deep(.au-link) {
  color: var(--color-topbar-fg);
}
.au-topbar :deep(.au-brand) {
  color: var(--color-topbar-fg);
}
.au-brand {
  font-weight: 600;
}
.au-scope-chip {
  color: var(--color-topbar-fg);
}
.au-unread-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  margin-left: var(--space-2);
  padding: 0 var(--space-1);
  border-radius: 999px;
  background-color: var(--color-badge-bg, var(--color-sidebar-active-indicator));
  color: var(--color-badge-fg, var(--color-topbar-bg));
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
}
</style>
