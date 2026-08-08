<script setup lang="ts">
import AppPageHeader from '../aurora/AppPageHeader.vue';
import AppStatusBadge from '../aurora/AppStatusBadge.vue';
</script>

<template>
  <section class="au-status au-surface" data-testid="auth-unavailable-view">
    <AppPageHeader title="登录" />
    <AppStatusBadge tone="warning">功能未提供</AppStatusBadge>
    <p class="au-status-detail">
      平台认证后端尚未实现（G10）。当前预览以安全的「认证能力未提供」状态展示，不会伪造登录成功或假用户；认证入口将在对应后端实现后启用。
    </p>
  </section>
</template>

<style scoped>
.au-status-detail {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
</style>
