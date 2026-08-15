<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    description: string;
    tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  }>(),
  { tone: 'neutral' },
);
</script>

<template>
  <section :class="['au-empty-state', `au-empty-state--${tone}`]" role="status">
    <h2 class="au-empty-state__title">{{ title }}</h2>
    <p class="au-empty-state__description">{{ description }}</p>
    <slot name="actions" />
  </section>
</template>

<style scoped>
.au-empty-state {
  padding: var(--space-6);
  border: 1px dashed var(--color-border-default);
  border-radius: var(--radius-surface);
  color: var(--color-text-primary);
  background-color: var(--color-surface-bg);
}
.au-empty-state__title,
.au-empty-state__description {
  margin: 0;
}
.au-empty-state__title {
  font-size: 16px;
}
.au-empty-state__description {
  margin-top: var(--space-2);
  color: var(--color-text-secondary);
}
.au-empty-state--info {
  border-color: var(--color-status-info);
}
.au-empty-state--success {
  border-color: var(--color-status-success);
}
.au-empty-state--warning {
  border-color: var(--color-status-warning);
}
.au-empty-state--danger {
  border-color: var(--color-status-danger);
}
</style>
