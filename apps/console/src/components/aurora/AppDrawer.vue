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
  >
    <slot />
  </Drawer>
</template>
