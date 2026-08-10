<script setup lang="ts">
/**
 * C5 请求工作区（`project.requests`，PLT-06）。
 *
 * 只消费 `requestsListEndpoints`（DAT-16）真实投影：summary 方法聚合 +
 * endpoints 分页列表；`percentiles` 恒 `unavailable`；`dataThrough`/`isPartial`
 * 如实展示；不显示伪精确比率，原始 URL/参数值/请求体不返回。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { formatUtc } from '../../monitoring/format.js';
import {
  fetchRequestEndpoints,
  type RequestEndpointSummary,
  type RequestEndpointsData,
} from '../../monitoring/queries.js';
import { defaultTimeRange } from '../../monitoring/time-range.js';
import { toSectionView } from '../../monitoring/section.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';
import {
  buildRequestsView,
  endpointsSectionToPage,
  mergeEndpointsPage,
  type RequestsViewState,
} from './requests-view-model.js';

const route = useRoute();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const scope = { organizationId, projectId };
const window = defaultTimeRange();

const data = ref<RequestEndpointsData | null>(null);
const items = ref<readonly RequestEndpointSummary[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(reset: boolean): Promise<void> {
  loading.value = true;
  error.value = null;
  if (reset) {
    items.value = [];
    nextCursor.value = null;
  }
  try {
    const query: { timeRange: { start: string; end: string }; cursor?: string } = {
      timeRange: { start: window.start, end: window.end },
    };
    if (!reset && nextCursor.value !== null) query.cursor = nextCursor.value;
    const response = await fetchRequestEndpoints(scope, query);
    data.value = response;
    if (response.endpoints.status === 'available') {
      const page = endpointsSectionToPage(response.endpoints);
      const merged = mergeEndpointsPage(reset ? [] : items.value, page);
      items.value = merged.items;
      nextCursor.value = merged.nextCursor;
    } else {
      items.value = [];
      nextCursor.value = null;
    }
  } catch (caught) {
    error.value = describeRequestError(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load(true);
});

const state = computed<RequestsViewState>(() =>
  buildRequestsView({
    loading: loading.value,
    error: error.value,
    summary:
      data.value?.summary === undefined
        ? null
        : toSectionView({
            loading: loading.value,
            error: error.value,
            section: data.value.summary,
          }),
    endpointsPage:
      data.value?.endpoints === undefined ? null : endpointsSectionToPage(data.value.endpoints),
  }),
);
</script>

<template>
  <section class="au-surface" data-testid="project-requests-view">
    <AppPageHeader title="请求" />

    <section class="mon-block" data-testid="requests-summary">
      <h2 class="mon-title">请求聚合</h2>
      <template v-if="state.summary.kind !== 'available'">
        <SectionNotice :view="state.summary" />
      </template>
      <template v-else>
        <dl v-if="state.summary.data.methods.length > 0" class="mon-inline">
          <div v-for="method in state.summary.data.methods" :key="method.method">
            <dt>{{ method.method }}</dt>
            <dd>
              {{ method.observedCount }} 次
              <span class="mon-meta">
                （失败 {{ method.failureCount }} · 慢 {{ method.slowCount }} · 最大
                {{ method.durationMaxMs }}ms）
              </span>
            </dd>
          </div>
        </dl>
        <p v-else class="mon-hint">窗口内没有请求指标。</p>
        <p v-if="state.summary.data.dataThrough" class="mon-meta">
          数据至 {{ formatUtc(state.summary.data.dataThrough) }}
          <template v-if="state.summary.data.isPartial"> · 部分结果</template>
        </p>
      </template>
    </section>

    <section class="mon-block" data-testid="requests-endpoints">
      <h2 class="mon-title">接口列表</h2>
      <template v-if="state.endpoints.kind !== 'available'">
        <SectionNotice :view="state.endpoints" />
      </template>
      <template v-else>
        <ul v-if="items.length > 0" class="mon-endpoint-list">
          <li v-for="endpoint in items" :key="endpoint.endpointId" class="mon-endpoint">
            <span class="mon-method">{{ endpoint.method }}</span>
            <span class="mon-url">{{ endpoint.url }}</span>
            <div class="mon-meta">
              {{ endpoint.sampleCount }} 个样本
              <template v-if="endpoint.outcomeCounts.length > 0">
                · {{ endpoint.outcomeCounts.map((o) => `${o.outcome} ${o.count}`).join(' · ') }}
              </template>
              <template v-if="endpoint.dataThrough !== undefined">
                · 至 {{ formatUtc(endpoint.dataThrough) }}</template
              >
              <template v-if="endpoint.isPartial"> · 部分结果</template>
              <template v-if="!endpoint.completeness.bounded"> · 采样不受限</template>
            </div>
          </li>
        </ul>
        <p v-else class="mon-hint">窗口内没有接口数据。</p>
        <div v-if="nextCursor !== null" class="mon-actions-row">
          <button
            type="button"
            class="au-button"
            data-testid="requests-load-more"
            :disabled="loading"
            @click="load(false)"
          >
            加载更多
          </button>
        </div>
      </template>
    </section>

    <section class="mon-block" data-testid="requests-percentiles">
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
.mon-inline dt {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-inline dd {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.mon-endpoint-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.mon-endpoint {
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  padding: var(--space-3);
}
.mon-method {
  display: inline-block;
  min-width: 48px;
  font-weight: 600;
  color: var(--color-action-primary);
}
.mon-url {
  color: var(--color-text-primary);
}
.mon-actions-row {
  margin-top: var(--space-3);
}
.au-button {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-height);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  cursor: pointer;
  font: inherit;
}
.au-button:hover {
  border-color: var(--color-action-primary);
  color: var(--color-action-primary);
}
.au-button:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
