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
const { organizations, currentOrganizationId } = storeToRefs(navigation);

const authenticated = computed(() => sessionStatus.value === 'authenticated');
const orgLabel = computed(() => {
  if (!authenticated.value) return '未登录';
  const org = organizations.value.find(
    (candidate) => candidate.organizationId === currentOrganizationId.value,
  );
  return org?.name ?? '未选择';
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
      <AppLink :to="hrefFor('account.notifications')" label="通知" />
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
.au-brand {
  font-weight: 600;
}
.au-scope-chip {
  color: var(--color-topbar-fg);
}
</style>
