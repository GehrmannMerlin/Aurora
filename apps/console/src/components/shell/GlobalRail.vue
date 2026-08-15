<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { resolveRouteTarget } from '../../contracts/route-registry';
import { useNavigationStore } from '../../stores/navigation';
import AppLink from '../aurora/AppLink.vue';
import GlobalNavigation from './GlobalNavigation.vue';
const emit = defineEmits<{ (event: 'navigate'): void }>();
const navigation = useNavigationStore();
const { defaultTarget } = storeToRefs(navigation);
const brandHref = computed(() => {
  const target = defaultTarget.value;
  if (target === null) return null;
  return (
    resolveRouteTarget({
      routeId: target.routeId as never,
      pathParams: target.pathParams,
      query: target.query,
    }).path ?? null
  );
});
</script>

<template>
  <aside class="au-global-rail" aria-label="Aurora">
    <AppLink
      v-if="brandHref !== null"
      class="au-global-rail__brand"
      :to="brandHref"
      aria-label="Aurora：进入已授权的工作空间入口"
      @click="emit('navigate')"
      >A</AppLink
    >
    <div v-else class="au-global-rail__brand" aria-label="Aurora">A</div>
    <GlobalNavigation @navigate="emit('navigate')" />
  </aside>
</template>

<style scoped>
.au-global-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 0;
  overflow-y: auto;
  background: var(--color-rail-bg);
  color: var(--color-rail-fg);
}
.au-global-rail__brand {
  display: grid;
  width: 48px;
  height: 48px;
  min-height: 48px;
  margin-top: var(--space-2);
  padding: 0;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 24%);
  border-radius: var(--radius-control);
  color: var(--color-rail-fg);
  font-weight: 700;
  text-decoration: none;
}
</style>
