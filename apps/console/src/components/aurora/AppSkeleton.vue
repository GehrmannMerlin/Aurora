<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    lines?: number;
    label?: string;
  }>(),
  { lines: 3, label: '正在加载…' },
);

const visibleLines = computed(() =>
  Array.from({ length: Math.max(1, props.lines) }, (_, index) => index),
);
</script>

<template>
  <div class="au-skeleton" role="status" aria-live="polite">
    <span class="au-skeleton__label">{{ label }}</span>
    <span v-for="line in visibleLines" :key="line" class="au-skeleton__line" aria-hidden="true" />
  </div>
</template>

<style scoped>
.au-skeleton {
  display: grid;
  gap: var(--space-2);
}
.au-skeleton__label {
  color: var(--color-text-secondary);
}
.au-skeleton__line {
  display: block;
  height: var(--compact-control-height);
  border-radius: var(--radius-control);
  background-color: var(--color-context-bg);
  animation: au-skeleton-pulse var(--motion-standard) ease-in-out infinite alternate;
}
.au-skeleton__line:last-child {
  width: 72%;
}
@keyframes au-skeleton-pulse {
  to {
    opacity: 0.56;
  }
}
@media (prefers-reduced-motion: reduce) {
  .au-skeleton__line {
    animation: none;
  }
}
</style>
