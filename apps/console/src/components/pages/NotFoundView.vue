<script setup lang="ts">
withDefaults(defineProps<{ title?: string }>(), { title: '页面不存在' });
</script>

<template>
  <section class="au-status au-surface" data-testid="not-found-view">
    <h1 id="page-title" tabindex="-1" class="au-page-title">{{ title }}</h1>
    <p class="au-status-detail">请求的地址不存在或目标已失效。</p>
  </section>
</template>

<style scoped>
.au-page-title {
  margin: 0;
  font-size: 20px;
  line-height: var(--nav-height);
  color: var(--color-text-primary);
}
.au-status-detail {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
</style>
