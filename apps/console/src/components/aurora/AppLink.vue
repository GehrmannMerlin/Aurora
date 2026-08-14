<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    to: string;
    label?: string;
    active?: boolean;
  }>(),
  { active: false },
);

const classes = computed(() => ['au-link', { 'au-link--active': props.active }]);
</script>

<template>
  <RouterLink :to="to" :class="classes" role="link" :aria-current="active ? 'page' : undefined">
    <slot>{{ label }}</slot>
  </RouterLink>
</template>

<style scoped>
.au-link {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-height);
  padding: 0 var(--space-2);
  border-radius: var(--radius-control);
  color: var(--color-action-primary);
  text-decoration: none;
  background-image: none;
}
.au-link--active {
  background-color: var(--color-context-active-bg);
  color: var(--color-context-active-fg);
}
</style>
