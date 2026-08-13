<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ApiError } from '../../api/errors.js';
import { describeRequestError } from '../../api/feedback.js';
import { fetchUsageSummary, type UsageSummaryData } from '../../monitoring/queries.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';

const route = useRoute();
const data = ref<UsageSummaryData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const organizationId = computed(() => {
  const raw = route.params.organizationId;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
});

const stageLabel = computed(() => {
  switch (data.value?.stage) {
    case 'near-limit':
      return '接近限额';
    case 'degraded':
      return '已降级';
    case 'hard-limit':
      return '已达硬限';
    default:
      return '正常';
  }
});

function describeUsageError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.code === 'authorization') return '你没有查看该组织用量的权限。';
    if (caught.code === 'authentication') return '登录状态已失效，请重新登录。';
  }
  return describeRequestError(caught);
}

async function load(): Promise<void> {
  if (organizationId.value === null) return;
  loading.value = true;
  error.value = null;
  try {
    data.value = await fetchUsageSummary(organizationId.value);
  } catch (caught) {
    data.value = null;
    error.value = describeUsageError(caught);
  } finally {
    loading.value = false;
  }
}

watch(organizationId, () => void load(), { immediate: true });
</script>

<template>
  <section class="au-surface" data-testid="usage-view">
    <AppPageHeader title="资源用量" />
    <p v-if="loading" class="au-hint" role="status">正在加载用量…</p>
    <AppStatusBadge v-else-if="error !== null" tone="danger" data-testid="usage-error">
      {{ error }}
    </AppStatusBadge>
    <template v-else-if="data !== null">
      <div class="au-usage-heading">
        <p class="au-hint">统计周期：{{ data.periodStart }} — {{ data.periodEnd }}</p>
        <AppStatusBadge :tone="data.stage === 'normal' ? 'success' : 'warning'">
          {{ stageLabel }}
        </AppStatusBadge>
      </div>
      <dl class="au-usage-grid">
        <div>
          <dt>已接收事件</dt>
          <dd data-testid="usage-accepted">{{ data.acceptedEvents }}</dd>
        </div>
        <div>
          <dt>已处理证据</dt>
          <dd data-testid="usage-processed">{{ data.processedEvents }}</dd>
        </div>
        <div>
          <dt>周期限额</dt>
          <dd>{{ data.quotaAcceptedEvents }}</dd>
        </div>
        <div>
          <dt>限额使用率</dt>
          <dd>{{ (data.ratio * 100).toFixed(2) }}%</dd>
        </div>
      </dl>
      <p v-if="data.note !== undefined" class="au-hint">{{ data.note }}</p>
    </template>
  </section>
</template>

<style scoped>
.au-hint {
  color: var(--color-text-secondary);
}
.au-usage-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  border-bottom: 1px solid var(--color-border-default);
}
.au-usage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-4);
  margin: var(--space-4) 0;
}
.au-usage-grid div {
  padding: var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
}
.au-usage-grid dt {
  color: var(--color-text-secondary);
}
.au-usage-grid dd {
  margin: var(--space-2) 0 0;
  color: var(--color-text-primary);
  font-size: 20px;
  font-weight: 600;
}
</style>
