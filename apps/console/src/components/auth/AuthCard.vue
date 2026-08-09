<script setup lang="ts">
import AppPageHeader from '../aurora/AppPageHeader.vue';

defineProps<{ title: string; testId?: string }>();
</script>

<template>
  <section class="au-auth-card au-surface" :data-testid="testId">
    <AppPageHeader :title="title" />
    <slot />
  </section>
</template>

<style scoped>
.au-auth-card {
  max-width: 480px;
  padding: var(--space-5);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
}
</style>
