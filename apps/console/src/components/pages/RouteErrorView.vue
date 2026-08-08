<script setup lang="ts">
import { useRouter } from 'vue-router';
import AppButton from '../aurora/AppButton.vue';
import AppPageHeader from '../aurora/AppPageHeader.vue';
import AppStatusBadge from '../aurora/AppStatusBadge.vue';

const router = useRouter();

function retry(): void {
  void router.go(0);
}
</script>

<template>
  <section class="au-status au-surface" data-testid="route-error-view">
    <AppPageHeader title="页面加载失败" />
    <AppStatusBadge tone="danger">可重试错误</AppStatusBadge>
    <p class="au-status-detail">页面加载过程中发生错误。错误详情不包含任何敏感信息，请重试。</p>
    <AppButton @click="retry">重试</AppButton>
  </section>
</template>

<style scoped>
.au-status-detail {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
</style>
