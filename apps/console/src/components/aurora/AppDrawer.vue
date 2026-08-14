<script setup lang="ts">
import { computed } from 'vue';
import Drawer from 'primevue/drawer';

const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const visible = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value) emit('close');
  },
});
</script>

<template>
  <Drawer
    id="nav-drawer"
    v-model:visible="visible"
    :header="title"
    position="left"
    class="au-drawer"
    :aria-label="title"
    :close-button-props="{ 'aria-label': '关闭导航' }"
    :pt="{ mask: { class: 'au-navigation-drawer-mask' } }"
  >
    <slot />
  </Drawer>
</template>

<style>
.p-drawer.au-drawer {
  width: min(19rem, 86vw);
  border-right: 1px solid var(--color-border-default);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
}
.p-drawer.au-drawer .p-drawer-header {
  min-height: var(--nav-height);
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--color-border-default);
}
.p-drawer.au-drawer .p-drawer-content {
  padding: 0;
}
.p-drawer.au-drawer .p-drawer-close-button {
  color: var(--color-text-primary);
}
.p-drawer-mask.au-navigation-drawer-mask {
  background-color: rgb(17 24 39 / 45%);
}
</style>
