<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
    testId?: string;
  }>(),
  { tone: 'neutral' },
);
</script>

<template>
  <section :class="['au-section', `au-section--${tone}`]" :data-testid="testId">
    <header class="au-section__header">
      <div>
        <h2>{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <slot name="actions" />
    </header>
    <slot />
  </section>
</template>

<style scoped>
.au-section {
  padding: var(--space-5);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-surface);
  background-color: var(--color-surface-bg);
}
.au-section__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.au-section__header h2,
.au-section__header p {
  margin: 0;
}
.au-section__header h2 {
  color: var(--color-text-primary);
  font-size: 16px;
  line-height: 1.4;
}
.au-section__header p {
  margin-top: var(--space-1);
  color: var(--color-text-secondary);
}
.au-section--info {
  border-color: var(--color-status-info);
}
.au-section--success {
  border-color: var(--color-status-success);
}
.au-section--warning {
  border-color: var(--color-status-warning);
}
.au-section--danger {
  border-color: var(--color-status-danger);
}
</style>
