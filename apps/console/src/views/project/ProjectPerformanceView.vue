<script setup lang="ts">
/**
 * C6 性能工作区（`project.performance`，PLT-06）。
 *
 * 只消费 `performanceListPages`（DAT-17）真实投影：LCP/INP/CLS/page_load 聚合
 * （`mean` 为真实聚合非采样外推）；`pages`/`percentiles` 恒 `unavailable`（页面
 * 维度无数据、percentile deferred），不伪造页面列表或百分位。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { formatUtc } from '../../monitoring/format.js';
import { fetchPerformancePages, type PerformancePagesData } from '../../monitoring/queries.js';
import { toSectionView } from '../../monitoring/section.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';
import { buildPerformanceView, metricLabel, metricUnit } from './performance-view-model.js';

const route = useRoute();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const scope = { organizationId, projectId };

const data = ref<PerformancePagesData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    data.value = await fetchPerformancePages(scope);
  } catch (caught) {
    data.value = null;
    error.value = describeRequestError(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

const state = computed(() =>
  buildPerformanceView({
    metrics:
      data.value === null
        ? null
        : toSectionView({
            loading: loading.value,
            error: error.value,
            section: data.value.metrics,
          }),
  }),
);
</script>

<template>
  <section class="au-surface" data-testid="project-performance-view">
    <AppPageHeader title="性能" />

    <section class="mon-block" data-testid="performance-metrics">
      <h2 class="mon-title">页面性能指标</h2>
      <template v-if="state.metrics.kind !== 'available'">
        <SectionNotice :view="state.metrics" />
      </template>
      <template v-else>
        <dl v-if="state.metrics.data.metrics.length > 0" class="mon-inline">
          <div
            v-for="metric in state.metrics.data.metrics"
            :key="metric.metricName"
            class="mon-metric"
          >
            <dt>{{ metricLabel(metric.metricName) }}</dt>
            <dd>
              {{ metric.mean }} {{ metricUnit(metric.unit) }}
              <span class="mon-meta"
                >（样本 {{ metric.observedCount }} · 最大 {{ metric.valueMax }}）</span
              >
            </dd>
          </div>
        </dl>
        <p v-else class="mon-hint">窗口内没有性能指标。</p>
        <p v-if="state.metrics.data.dataThrough" class="mon-meta">
          数据至 {{ formatUtc(state.metrics.data.dataThrough) }}
          <template v-if="state.metrics.data.isPartial"> · 部分结果</template>
        </p>
      </template>
    </section>

    <section class="mon-block" data-testid="performance-pages">
      <h2 class="mon-title">页面维度</h2>
      <SectionNotice :view="state.pages" />
    </section>

    <section class="mon-block" data-testid="performance-percentiles">
      <h2 class="mon-title">百分位</h2>
      <SectionNotice :view="state.percentiles" />
    </section>
  </section>
</template>

<style scoped>
.mon-block {
  margin-bottom: var(--space-5);
}
.mon-title {
  margin: 0 0 var(--space-2);
  font-size: 16px;
  color: var(--color-text-primary);
}
.mon-hint {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
.mon-meta {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-inline {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: 0;
}
.mon-metric {
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  padding: var(--space-3);
  min-width: 180px;
}
.mon-metric dt {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-metric dd {
  margin: var(--space-1) 0 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
}
</style>
