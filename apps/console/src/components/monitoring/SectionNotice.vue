<script setup lang="ts">
/**
 * Renders the non-data state of a monitoring `SectionView`: loading, error,
 * empty, partial, stale, unavailable, forbidden. When the section is
 * `available` this component renders nothing — the parent renders the data.
 */
import { computed } from 'vue';
import type { SectionView } from '../../monitoring/section.js';

const props = defineProps<{ view: SectionView<unknown> }>();

const message = computed<string | null>(() => {
  switch (props.view.kind) {
    case 'loading':
      return '正在加载…';
    case 'error':
      return props.view.message;
    case 'empty':
      return props.view.reason;
    case 'partial':
      return `部分数据：${props.view.missing}`;
    case 'stale':
      return `数据已过期：${props.view.staleReason}`;
    case 'unavailable':
      return props.view.reason;
    case 'forbidden':
      return '无权限查看该数据';
    case 'available':
      return null;
  }
});
</script>

<template>
  <p
    v-if="message !== null"
    class="mon-notice"
    :class="`mon-notice--${props.view.kind}`"
    role="status"
  >
    {{ message }}
  </p>
</template>

<style scoped>
.mon-notice {
  margin: 0;
  color: var(--color-text-secondary);
}
.mon-notice--error {
  color: var(--color-status-danger);
}
.mon-notice--forbidden {
  color: var(--color-status-danger);
}
</style>
