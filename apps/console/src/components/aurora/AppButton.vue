<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger';
    disabled?: boolean;
    type?: 'button' | 'submit';
  }>(),
  { variant: 'primary', disabled: false, type: 'button' },
);

const emit = defineEmits<{ (e: 'click', event: MouseEvent): void }>();
</script>

<template>
  <button
    :class="['au-button', `au-button--${variant}`]"
    :disabled="disabled"
    :type="type"
    @click="!disabled && emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped>
.au-button {
  height: var(--control-height);
  padding: 0 var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-base);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  background-image: none;
}
.au-button:disabled {
  cursor: not-allowed;
}
.au-button--primary {
  background-color: var(--color-action-primary);
  color: #ffffff;
}
.au-button--secondary {
  background-color: var(--color-surface-bg);
  border-color: var(--color-border-default);
  color: var(--color-text-primary);
}
.au-button--danger {
  background-color: var(--color-status-danger);
  color: #ffffff;
}
</style>
