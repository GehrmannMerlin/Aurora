<script setup lang="ts">
import { computed } from 'vue';
import { Bell, LayoutGrid, ShieldCheck, SlidersHorizontal } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import { resolveRouteTarget } from '../../contracts/route-registry';
import { useNavigationStore } from '../../stores/navigation';
import AppLink from '../aurora/AppLink.vue';

const props = withDefaults(defineProps<{ expanded?: boolean }>(), { expanded: false });
const emit = defineEmits<{ (event: 'navigate'): void }>();
const route = useRoute();
const navigation = useNavigationStore();
const { unreadCount, workspaceTargets } = storeToRefs(navigation);

const items = computed(() => [
  { routeId: 'workspace.home', label: '工作空间', icon: LayoutGrid },
  { routeId: 'account.notifications', label: '通知', icon: Bell },
  { routeId: 'account.security', label: '账号安全', icon: ShieldCheck },
] as const);
const unreadBadge = computed(() =>
  unreadCount.value.status === 'available' && (unreadCount.value.value ?? 0) > 0
    ? String(unreadCount.value.value)
    : null,
);
const resourcePolicyTarget = computed(
  () =>
    workspaceTargets.value.find((target) => target.routeId === 'platform.resource-policies') ?? null,
);
const resourcePolicyHref = computed(() => {
  const target = resourcePolicyTarget.value;
  if (target === null) return null;
  return resolveRouteTarget({
    routeId: target.routeId as never,
    pathParams: target.pathParams,
    query: target.query,
  }).path ?? null;
});
function hrefFor(routeId: (typeof items.value)[number]['routeId']): string {
  return resolveRouteTarget({ routeId, pathParams: {}, query: {} }).path ?? '/not-found';
}
function labelFor(routeId: (typeof items.value)[number]['routeId']): string {
  if (routeId !== 'account.notifications' || unreadBadge.value === null) return items.value.find((item) => item.routeId === routeId)?.label ?? '';
  return `通知，${unreadBadge.value} 条未读`;
}
function isActive(routeId: string): boolean {
  return route.name === routeId;
}
function handleWorkspace(): void {
  navigation.activateWorkspace();
  emit('navigate');
}
</script>

<template>
  <nav class="au-global-navigation" :class="{ 'au-global-navigation--expanded': props.expanded }" aria-label="全局导航">
    <ul>
      <li v-for="item in items" :key="item.routeId">
        <AppLink
          v-if="props.expanded"
          :to="hrefFor(item.routeId)"
          :label="labelFor(item.routeId)"
          :aria-label="labelFor(item.routeId)"
          :active="isActive(item.routeId)"
          @click="item.routeId === 'workspace.home' ? handleWorkspace() : emit('navigate')"
        >
          <component :is="item.icon" :size="20" stroke-width="1.8" aria-hidden="true" />
          <span v-if="props.expanded">{{ item.label }}</span>
          <span v-if="item.routeId === 'account.notifications' && unreadBadge !== null" class="au-global-unread" aria-hidden="true">{{ unreadBadge }}</span>
        </AppLink>
        <AppLink
          v-else
          :to="hrefFor(item.routeId)"
          :aria-label="labelFor(item.routeId)"
          :title="item.label"
          :active="isActive(item.routeId)"
          @click="item.routeId === 'workspace.home' ? handleWorkspace() : emit('navigate')"
        >
          <component :is="item.icon" :size="20" stroke-width="1.8" aria-hidden="true" />
          <span v-if="item.routeId === 'account.notifications' && unreadBadge !== null" class="au-global-unread" aria-hidden="true">{{ unreadBadge }}</span>
        </AppLink>
      </li>
      <li v-if="resourcePolicyHref !== null">
        <AppLink
          :to="resourcePolicyHref"
          label="资源策略"
          aria-label="资源策略"
          :active="isActive('platform.resource-policies')"
          @click="emit('navigate')"
        >
          <SlidersHorizontal :size="20" stroke-width="1.8" aria-hidden="true" />
          <span v-if="props.expanded">资源策略</span>
        </AppLink>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.au-global-navigation { width: 100%; }
.au-global-navigation ul { display: grid; gap: var(--space-2); margin: 0; padding: var(--space-3) var(--space-2); list-style: none; }
.au-global-navigation :deep(.au-link) { position: relative; justify-content: center; width: 48px; height: 48px; min-height: 48px; padding: 0; border-radius: var(--radius-control); color: var(--color-rail-muted); }
.au-global-navigation :deep(.au-link:hover), .au-global-navigation :deep(.au-link:focus-visible), .au-global-navigation :deep(.au-link--active) { background: rgb(255 255 255 / 12%); color: var(--color-rail-fg); }
.au-global-navigation--expanded :deep(.au-link) { justify-content: flex-start; width: 100%; gap: var(--space-3); padding: 0 var(--space-3); }
.au-global-navigation--expanded :deep(.au-link) { color: var(--color-text-secondary); }
.au-global-navigation--expanded :deep(.au-link:hover), .au-global-navigation--expanded :deep(.au-link:focus-visible), .au-global-navigation--expanded :deep(.au-link--active) { background: var(--color-context-active-bg); color: var(--color-context-active-fg); }
.au-global-unread { position: absolute; top: 5px; right: 5px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: var(--color-status-danger); color: white; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; }
.au-global-navigation--expanded .au-global-unread { position: static; margin-left: auto; }
</style>
