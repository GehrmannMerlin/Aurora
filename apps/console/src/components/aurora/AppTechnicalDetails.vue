<script setup lang="ts">
withDefaults(defineProps<{ summary?: string }>(), { summary: '技术详情' });
</script>

<template>
  <details class="au-technical-details">
    <summary>{{ summary }}</summary>
    <pre><slot /></pre>
  </details>
</template>

<style scoped>
.au-technical-details {
  color: var(--color-text-secondary);
  font-family: var(--font-family-mono);
  font-size: 12px;
}
.au-technical-details summary {
  color: var(--color-text-primary);
  font-family: var(--font-family-base);
  cursor: pointer;
}
.au-technical-details pre {
  margin: var(--space-3) 0 0;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
