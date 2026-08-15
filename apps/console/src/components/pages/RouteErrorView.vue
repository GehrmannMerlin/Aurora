<script setup lang="ts">
import { useRouter } from 'vue-router';
import AppButton from '../aurora/AppButton.vue';
import AppEmptyState from '../aurora/AppEmptyState.vue';
import AppPageHeader from '../aurora/AppPageHeader.vue';

const router = useRouter();

function retry(): void {
  void router.go(0);
}
</script>

<template>
  <section class="au-status au-surface" data-testid="route-error-view">
    <AppPageHeader title="页面加载失败" />
    <AppEmptyState
      title="可重试错误"
      tone="danger"
      description="页面加载过程中发生错误。错误详情不包含任何敏感信息，请重试。"
    >
      <template #actions><AppButton @click="retry">重试</AppButton></template>
    </AppEmptyState>
  </section>
</template>
