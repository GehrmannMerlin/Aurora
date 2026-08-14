<script setup lang="ts">
defineProps<{
  title: string;
  eyebrow?: string;
  description?: string;
  testId?: string;
}>();
</script>

<template>
  <header class="au-page-header">
    <div class="au-page-header__heading">
      <p v-if="eyebrow" class="au-page-header__eyebrow">{{ eyebrow }}</p>
      <h1 :id="testId ?? 'page-title'" tabindex="-1" class="au-page-title">{{ title }}</h1>
      <p v-if="description" class="au-page-header__description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions || $slots.meta" class="au-page-header__supporting">
      <div v-if="$slots.actions" class="au-page-header__actions"><slot name="actions" /></div>
      <div v-if="$slots.meta" class="au-page-header__meta"><slot name="meta" /></div>
    </div>
  </header>
</template>

<style scoped>
.au-page-header {
  margin-bottom: var(--space-5);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}
.au-page-title {
  margin: 0;
  font-size: 20px;
  line-height: 1.3;
  color: var(--color-text-primary);
}
.au-page-header__eyebrow,
.au-page-header__description,
.au-page-header__meta {
  margin: 0;
  color: var(--color-text-secondary);
}
.au-page-header__eyebrow {
  margin-bottom: var(--space-1);
  font-size: 12px;
  font-weight: 600;
}
.au-page-header__description {
  margin-top: var(--space-2);
}
.au-page-header__supporting {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
}
.au-page-header__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
