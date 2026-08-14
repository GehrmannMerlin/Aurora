<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppSection from '../../components/aurora/AppSection.vue';
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
    <AppPageHeader title="用量" description="组织资源事实将在契约支持后显示。" />
    <AppSection title="资源用量" description="当前没有可用的用量查询能力。" tone="warning" data-testid="usage-unavailable-section">
      <AppStatusBadge tone="warning">功能未提供</AppStatusBadge>
      <p class="au-status-detail">资源用量上报尚未提供；此处不会显示任何模拟数据、趋势、预测、账单或升级信息。</p>
      <p v-if="organizationId !== null" class="au-status-scope">组织 {{ organizationId }}</p>
    </AppSection>
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
