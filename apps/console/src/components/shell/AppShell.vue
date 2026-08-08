<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useNavigationStore } from '../../stores/navigation';
import { useSessionStore } from '../../stores/session';
import ContentOutlet from './ContentOutlet.vue';
import GlobalLoading from './GlobalLoading.vue';
import LayeredSidebar from './LayeredSidebar.vue';
import TopBar from './TopBar.vue';

const session = useSessionStore();
const navigation = useNavigationStore();
const { status } = storeToRefs(session);

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
      <LayeredSidebar />
      <main class="au-content">
        <ContentOutlet />
      </main>
    </div>
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
</style>
