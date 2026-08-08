<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useNavigationStore } from '../../stores/navigation';
import { useSessionStore } from '../../stores/session';
import AppButton from '../aurora/AppButton.vue';
import AppDrawer from '../aurora/AppDrawer.vue';
import ContentOutlet from './ContentOutlet.vue';
import GlobalLoading from './GlobalLoading.vue';
import LayeredSidebar from './LayeredSidebar.vue';
import TopBar from './TopBar.vue';

const session = useSessionStore();
const navigation = useNavigationStore();
const { status } = storeToRefs(session);
const drawerOpen = ref(false);

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
</script>

<template>
  <div class="au-shell">
    <TopBar />
    <div class="au-shell-body">
      <aside class="au-desktop-sidebar">
        <LayeredSidebar />
      </aside>
      <main class="au-content">
        <AppButton
          class="au-menu-trigger"
          variant="secondary"
          aria-haspopup="dialog"
          aria-controls="nav-drawer"
          @click="drawerOpen = true"
        >
          导航
        </AppButton>
        <ContentOutlet />
      </main>
    </div>
    <AppDrawer :open="drawerOpen" title="导航" @close="drawerOpen = false">
      <LayeredSidebar fill />
    </AppDrawer>
    <GlobalLoading v-if="status === 'loading'" />
  </div>
</template>

<style scoped>
.au-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--color-page-bg);
}
.au-shell-body {
  display: flex;
  flex: 1;
}
.au-content {
  flex: 1;
  min-width: 0;
  padding: var(--space-5);
}
.au-menu-trigger {
  margin-bottom: var(--space-4);
}
@media (min-width: 1024px) {
  .au-menu-trigger {
    display: none;
  }
}
@media (max-width: 1023px) {
  .au-desktop-sidebar {
    display: none;
  }
}
</style>
