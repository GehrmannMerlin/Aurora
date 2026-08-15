<script setup lang="ts">
import AppPageHeader from '../aurora/AppPageHeader.vue';
import AppEmptyState from '../aurora/AppEmptyState.vue';
</script>

<template>
  <section class="au-status au-surface" data-testid="auth-unavailable-view">
    <AppPageHeader title="登录" />
    <AppEmptyState
      title="功能未提供"
      tone="warning"
      description="平台认证后端尚未实现（G10）。当前预览以安全的「认证能力未提供」状态展示，不会伪造登录成功或假用户；认证入口将在对应后端实现后启用。"
    />
  </section>
</template>
