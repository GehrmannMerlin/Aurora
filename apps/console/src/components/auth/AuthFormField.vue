<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    type?: 'text' | 'email' | 'password';
    autocomplete?: string;
    value: string;
    required?: boolean;
    hint?: string;
    error?: string | undefined;
  }>(),
  { type: 'text', required: false },
);

const emit = defineEmits<{ (e: 'update:value', value: string): void }>();

/** Associate the input with the visible hint/error block via aria-describedby. */
function describedByIds(hint: string | undefined, error: string | undefined): string {
  // When a field error is shown it replaces the hint, so reference only the error.
  if (error !== undefined) return `${props.id}-error`;
  return hint !== undefined ? `${props.id}-hint` : '';
}
</script>

<template>
  <div class="au-field">
    <label class="au-field__label" :for="id">{{ label }}</label>
    <input
      :id="id"
      class="au-field__input"
      :class="{ 'au-field__input--invalid': error !== undefined }"
      :type="type"
      :autocomplete="autocomplete"
      :value="value"
      :required="required"
      :aria-invalid="error !== undefined ? 'true' : undefined"
      :aria-describedby="describedByIds(hint, error)"
      @input="emit('update:value', ($event.target as HTMLInputElement).value)"
    />
    <p v-if="hint !== undefined && error === undefined" :id="`${id}-hint`" class="au-field__hint">
      {{ hint }}
    </p>
    <p v-if="error !== undefined" :id="`${id}-error`" class="au-field__error" role="alert">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.au-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.au-field__label {
  color: var(--color-text-primary);
  font-weight: 500;
}
.au-field__input {
  height: var(--control-height);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  font: inherit;
}
.au-field__input--invalid {
  border-color: var(--color-status-danger);
}
.au-field__hint {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}
.au-field__error {
  margin: 0;
  font-size: 13px;
  color: var(--color-status-danger);
}
</style>
