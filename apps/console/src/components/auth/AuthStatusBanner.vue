<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    tone: 'neutral' | 'success' | 'danger' | 'warning';
    live?: boolean;
  }>(),
  { tone: 'neutral', live: false },
);

const role = computed<'status' | 'alert'>(() => (props.tone === 'danger' ? 'alert' : 'status'));
</script>

<template>
  <p
    :class="['au-status-banner', `au-status-banner--${tone}`]"
    :role="role"
    :aria-live="live ? (tone === 'danger' ? 'assertive' : 'polite') : undefined"
    data-testid="auth-status"
  >
    <slot />
  </p>
</template>

<style scoped>
.au-status-banner {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  color: var(--color-text-primary);
  background-image: none;
}
.au-status-banner--success {
  border-color: var(--color-status-success);
  color: var(--color-status-success);
}
.au-status-banner--danger {
  border-color: var(--color-status-danger);
  color: var(--color-status-danger);
}
.au-status-banner--warning {
  border-color: var(--color-sidebar-bg);
  color: var(--color-text-primary);
}
</style>
