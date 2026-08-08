<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'success' | 'danger' | 'warning';
  }>(),
  { tone: 'neutral' },
);
</script>

<template>
  <span :class="['au-badge', `au-badge--${tone}`]" role="status">
    <slot />
  </span>
</template>

<style scoped>
.au-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 24px;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background-image: none;
  color: var(--color-text-primary);
}
.au-badge--success {
  border-color: var(--color-status-success);
  color: var(--color-status-success);
}
.au-badge--danger {
  border-color: var(--color-status-danger);
  color: var(--color-status-danger);
}
.au-badge--warning {
  border-color: var(--color-sidebar-bg);
  color: var(--color-sidebar-fg);
}
</style>
