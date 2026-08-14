<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import { resolveRouteTarget } from '../../contracts/route-registry';
import { useNavigationStore } from '../../stores/navigation';
import { useSessionStore } from '../../stores/session';
import AppLink from '../aurora/AppLink.vue';
import ScopeSwitcher from './ScopeSwitcher.vue';

const session = useSessionStore();
const navigation = useNavigationStore();
const route = useRoute();
const { status: sessionStatus } = storeToRefs(session);
const { currentScope, unreadCount } = storeToRefs(navigation);

const authenticated = computed(() => sessionStatus.value === 'authenticated');
const routeScope = computed(() => route.meta.scope);
const workspaceActive = computed(
  () =>
    authenticated.value &&
    routeScope.value === 'workspace' &&
    currentScope.value?.type !== 'organization',
);
const organizationActive = computed(
  () =>
    authenticated.value &&
    (routeScope.value === 'organization' ||
      (routeScope.value === 'workspace' && currentScope.value?.type === 'organization')),
);
const projectActive = computed(() => authenticated.value && routeScope.value === 'project');
const notificationsActive = computed(() => route.name === 'account.notifications');
const securityActive = computed(() => route.name === 'account.security');

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
      <AppLink
        :to="hrefFor('workspace.home')"
        label="工作空间"
        :active="workspaceActive"
        @click="navigation.activateWorkspace()"
      />
      <ScopeSwitcher :organization-active="organizationActive" :project-active="projectActive" />
      <AppLink
        :to="hrefFor('account.notifications')"
        aria-label="通知"
        :active="notificationsActive"
      >
        通知
        <span
          v-if="unreadBadge !== null"
          class="au-unread-badge"
          data-testid="topbar-unread-badge"
          aria-hidden="true"
          >{{ unreadBadge }}</span
        >
      </AppLink>
      <AppLink :to="hrefFor('account.security')" label="账号安全" :active="securityActive" />
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
  flex-shrink: 0;
  white-space: nowrap;
}
.au-topnav {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-1);
}
.au-topnav :deep(.au-link) {
  color: var(--color-topbar-fg);
}
.au-topnav :deep(.au-link:hover),
.au-topnav :deep(.au-link:focus-visible),
.au-topnav :deep(.au-link--active) {
  background-color: rgb(248 250 252 / 12%);
}
.au-topnav :deep(.au-link--active) {
  border-left: 0;
  box-shadow: inset 0 -3px var(--color-sidebar-active-indicator);
}
.au-topbar :deep(.au-brand) {
  color: var(--color-topbar-fg);
}
.au-brand {
  flex: 0 0 auto;
  font-weight: 600;
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
@media (max-width: 767px) {
  .au-topbar {
    gap: var(--space-2);
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0 var(--space-3);
    scrollbar-width: thin;
  }
}
</style>
