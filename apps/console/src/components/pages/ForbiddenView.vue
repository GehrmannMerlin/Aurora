<script setup lang="ts">
import AppPageHeader from '../aurora/AppPageHeader.vue';
import AppStatusBadge from '../aurora/AppStatusBadge.vue';
</script>

<template>
  <section class="au-status au-surface" data-testid="forbidden-view">
    <AppPageHeader title="无权限访问" />
    <AppStatusBadge tone="danger">权限不足</AppStatusBadge>
    <p class="au-status-detail">
      你没有访问该资源的权限。出于安全原因，本页面不会透露目标是否存在。
    </p>
  </section>
</template>

<style scoped>
.au-status-detail {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
</style>
