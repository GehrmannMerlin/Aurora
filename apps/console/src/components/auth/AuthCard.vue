<script setup lang="ts">
import AppPageHeader from '../aurora/AppPageHeader.vue';

defineProps<{ title: string; description?: string; testId?: string }>();
</script>

<template>
  <section class="au-auth-card" :data-testid="testId">
    <AppPageHeader v-if="description !== undefined" :title="title" :description="description" />
    <AppPageHeader v-else :title="title" />
    <slot />
  </section>
</template>

<style scoped>
.au-auth-card {
  width: 100%;
}
</style>
