<script setup lang="ts">
defineProps<{ title: string; testId?: string }>();
</script>

<template>
  <header class="au-page-header">
    <h1 :id="testId ?? 'page-title'" tabindex="-1" class="au-page-title">{{ title }}</h1>
    <slot name="meta" />
  </header>
</template>

<style scoped>
.au-page-header {
  margin-bottom: var(--space-5);
}
.au-page-title {
  margin: 0;
  font-size: 20px;
  line-height: var(--nav-height);
  color: var(--color-text-primary);
}
</style>
