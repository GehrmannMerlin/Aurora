<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import { useNavigationStore } from '../../stores/navigation';
import { useSessionStore } from '../../stores/session';
import AppButton from '../aurora/AppButton.vue';
import AppDrawer from '../aurora/AppDrawer.vue';
import AuthShell from '../auth/AuthShell.vue';
import ContentOutlet from './ContentOutlet.vue';
import GlobalLoading from './GlobalLoading.vue';
import ContextSidebar from './ContextSidebar.vue';
import GlobalNavigation from './GlobalNavigation.vue';
import GlobalRail from './GlobalRail.vue';

const session = useSessionStore();
const navigation = useNavigationStore();
const { status } = storeToRefs(session);
const drawerOpen = ref(false);
const menuTrigger = ref<InstanceType<typeof AppButton> | null>(null);
let closeDrawerFrame: number | null = null;
let restorePageTitleAfterDrawer = false;
const route = useRoute();
const hasContext = computed(
  () => route.meta.scope === 'organization' || route.meta.scope === 'project',
);

onMounted(() => {
  void session.restore();
});

watch(
  () => session.status,
  (value) => {
    if (value === 'authenticated') void navigation.load();
  },
  { immediate: true },
);

function openDrawer(): void {
  if (closeDrawerFrame !== null) {
    cancelAnimationFrame(closeDrawerFrame);
    closeDrawerFrame = null;
  }
  drawerOpen.value = true;
}
function closeDrawer(restoreFocus = true): void {
  restorePageTitleAfterDrawer = !restoreFocus && drawerOpen.value;
  if (closeDrawerFrame !== null) cancelAnimationFrame(closeDrawerFrame);
  closeDrawerFrame = requestAnimationFrame(() => {
    closeDrawerFrame = null;
    drawerOpen.value = false;
    if (restoreFocus) void nextTick(() => menuTrigger.value?.$el?.focus());
  });
}

function focusPageTitleAfterDrawer(): void {
  if (!restorePageTitleAfterDrawer) return;
  restorePageTitleAfterDrawer = false;
  void nextTick(() => document.getElementById('page-title')?.focus({ preventScroll: true }));
}

onBeforeUnmount(() => {
  if (closeDrawerFrame !== null) cancelAnimationFrame(closeDrawerFrame);
});
</script>

<template>
  <AuthShell v-if="route.meta.scope === 'public'">
    <ContentOutlet />
  </AuthShell>
  <div v-else class="au-shell" :class="{ 'au-shell--global-only': !hasContext }">
    <GlobalRail class="au-desktop-rail" @navigate="closeDrawer(false)" />
    <aside v-if="hasContext" class="au-desktop-context">
      <ContextSidebar @navigate="closeDrawer(false)" />
    </aside>
    <main class="au-content">
      <header class="au-mobile-bar">
        <AppButton
          ref="menuTrigger"
          class="au-menu-trigger"
          variant="secondary"
          aria-haspopup="dialog"
          aria-controls="nav-drawer"
          @click="openDrawer"
          >导航</AppButton
        >
      </header>
      <ContentOutlet />
    </main>
    <AppDrawer
      :open="drawerOpen"
      title="导航"
      @close="closeDrawer"
      @after-hide="focusPageTitleAfterDrawer"
    >
      <GlobalNavigation expanded @navigate="closeDrawer(false)" />
      <ContextSidebar v-if="hasContext" mobile @navigate="closeDrawer(false)" />
    </AppDrawer>
    <GlobalLoading v-if="status === 'loading'" />
  </div>
</template>

<style scoped>
.au-shell {
  display: grid;
  grid-template-columns: var(--global-rail-width) var(--context-sidebar-width) minmax(0, 1fr);
  height: 100dvh;
  overflow: hidden;
  background-color: var(--color-page-bg);
}
.au-shell--global-only {
  grid-template-columns: var(--global-rail-width) minmax(0, 1fr);
}
.au-desktop-rail,
.au-desktop-context {
  min-height: 0;
  overflow: hidden;
}
.au-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-5);
}
.au-mobile-bar {
  display: none;
}
@media (max-width: 959px) {
  .au-shell,
  .au-shell--global-only {
    display: block;
  }
  .au-desktop-rail,
  .au-desktop-context {
    display: none;
  }
  .au-mobile-bar {
    display: flex;
    align-items: center;
    min-height: 52px;
    margin: calc(var(--space-5) * -1) calc(var(--space-5) * -1) var(--space-4);
    padding: 0 var(--space-4);
    border-bottom: 1px solid var(--color-border-default);
    background: var(--color-surface-bg);
  }
}
</style>
