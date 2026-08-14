<script setup lang="ts">
import GlobalNavigation from './GlobalNavigation.vue';
const emit = defineEmits<{ (event: 'navigate'): void }>();
</script>

<template>
  <aside class="au-global-rail" aria-label="Aurora">
    <div class="au-global-rail__brand" aria-hidden="true">A</div>
    <GlobalNavigation @navigate="emit('navigate')" />
  </aside>
</template>

<style scoped>
.au-global-rail { display: flex; flex-direction: column; align-items: center; min-height: 0; overflow-y: auto; background: var(--color-rail-bg); color: var(--color-rail-fg); }
.au-global-rail__brand { display: grid; width: 48px; height: 48px; margin-top: var(--space-2); place-items: center; border: 1px solid rgb(255 255 255 / 24%); border-radius: var(--radius-control); font-weight: 700; }
</style>
