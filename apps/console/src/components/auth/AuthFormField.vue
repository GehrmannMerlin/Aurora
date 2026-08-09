<script setup lang="ts">
withDefaults(
  defineProps<{
    id: string;
    label: string;
    type?: 'text' | 'email' | 'password';
    autocomplete?: string;
    value: string;
    required?: boolean;
  }>(),
  { type: 'text', required: false },
);

const emit = defineEmits<{ (e: 'update:value', value: string): void }>();
</script>

<template>
  <div class="au-field">
    <label class="au-field__label" :for="id">{{ label }}</label>
    <input
      :id="id"
      class="au-field__input"
      :type="type"
      :autocomplete="autocomplete"
      :value="value"
      :required="required"
      @input="emit('update:value', ($event.target as HTMLInputElement).value)"
    />
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
</style>
