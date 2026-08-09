<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';

const route = useRoute();

// The usage page is organization-scoped; the id is display-only and is never
// sent anywhere — the B5 `usageGetSummary` operation stays blocked, so this page
// shows an honest capability gap and never fabricates usage numbers or charts.
const organizationId = computed(() => {
  const raw = route.params.organizationId;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
});
</script>

<template>
  <section class="au-status au-surface" data-testid="usage-view">
    <AppPageHeader title="用量" />
    <AppStatusBadge tone="warning">功能未提供</AppStatusBadge>
    <p class="au-status-detail">
      资源用量上报尚未提供；此处不会显示任何模拟数据或图表。
    </p>
    <p v-if="organizationId !== null" class="au-status-scope">
      组织 {{ organizationId }}
    </p>
  </section>
</template>

<style scoped>
.au-status-detail {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
.au-status-scope {
  color: var(--color-text-secondary);
  font-size: 13px;
}
</style>
