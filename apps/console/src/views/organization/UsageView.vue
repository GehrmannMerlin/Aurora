<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ApiError } from '../../api/errors.js';
import { describeRequestError } from '../../api/feedback.js';
import { fetchUsageSummary, type UsageSummaryData } from '../../monitoring/queries.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppSection from '../../components/aurora/AppSection.vue';
import AppSkeleton from '../../components/aurora/AppSkeleton.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import AppTechnicalDetails from '../../components/aurora/AppTechnicalDetails.vue';

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
  <section class="au-surface mon-usage" data-testid="usage-view">
    <AppPageHeader
      title="资源用量"
      description="查看当前组织统计周期内的权威接收、处理与限额证据。"
    />
    <AppSkeleton v-if="loading" label="正在加载用量…" :lines="4" />
    <AppSection v-else-if="error !== null" title="用量暂不可用" tone="danger">
      <AppStatusBadge tone="danger" data-testid="usage-error">{{ error }}</AppStatusBadge>
    </AppSection>
    <template v-else-if="data !== null">
      <AppSection
        title="当前周期"
        :description="`${data.periodStart} — ${data.periodEnd}`"
        :tone="data.stage === 'normal' ? 'success' : 'warning'"
      >
        <AppStatusBadge :tone="data.stage === 'normal' ? 'success' : 'warning'">{{
          stageLabel
        }}</AppStatusBadge>
        <p v-if="data.note !== undefined" class="mon-note">{{ data.note }}</p>
      </AppSection>
      <AppSection
        title="用量证据"
        description="接收、处理与限额分别展示，不以图表或预测替代服务端事实。"
      >
        <dl class="mon-usage-grid">
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
        <AppTechnicalDetails summary="技术详情" data-testid="usage-technical-details"
          >组织 ID: {{ data.organizationId }}</AppTechnicalDetails
        >
      </AppSection>
    </template>
  </section>
</template>

<style scoped>
.mon-usage {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.mon-note {
  margin: var(--space-2) 0 0;
  color: var(--color-text-secondary);
}
.mon-usage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-3);
  margin: 0;
}
.mon-usage-grid > div {
  padding: var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
}
.mon-usage-grid dt {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-usage-grid dd {
  margin: var(--space-1) 0 0;
  color: var(--color-text-primary);
  font-size: 20px;
  font-weight: 650;
}
</style>
