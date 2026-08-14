<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '../../stores/session';
import AuthUnavailableView from './AuthUnavailableView.vue';
import UnavailableView from './UnavailableView.vue';
import WorkspaceHomeView from './WorkspaceHomeView.vue';

const session = useSessionStore();
const { status } = storeToRefs(session);

const view = computed<'workspace' | 'unavailable' | 'auth'>(() => {
  if (status.value === 'authenticated') return 'workspace';
  if (status.value === 'unavailable') return 'unavailable';
  return 'auth';
});
</script>

<template>
  <div class="root-view" aria-live="polite">
    <WorkspaceHomeView v-if="view === 'workspace'" />
    <UnavailableView
      v-else-if="view === 'unavailable'"
      title="认证能力未提供"
      reason="capability-not-provided"
      detail="平台认证后端尚未实现；会话以安全不可用状态展示，不会伪造登录。"
    />
    <AuthUnavailableView v-else />
  </div>
</template>
