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
import AppSection from '../../components/aurora/AppSection.vue';
import AppTechnicalDetails from '../../components/aurora/AppTechnicalDetails.vue';
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
const selectedEndpointId = ref<string | null>(null);

async function load(reset: boolean): Promise<void> {
  loading.value = true;
  error.value = null;
  if (reset) {
    items.value = [];
    nextCursor.value = null;
    selectedEndpointId.value = null;
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

const selectedEndpoint = computed(
  () => items.value.find((endpoint) => endpoint.endpointId === selectedEndpointId.value) ?? null,
);

function selectEndpoint(endpointId: string): void {
  selectedEndpointId.value = endpointId;
}
</script>

<template>
  <section class="au-surface" data-testid="project-requests-view">
    <AppPageHeader title="请求" />

    <div class="investigation-workspace">
      <AppSection title="接口" description="已规范化的接口身份；选择一项查看已返回的证据。">
        <div data-testid="investigation-list">
          <template v-if="state.endpoints.kind !== 'available'">
            <SectionNotice :view="state.endpoints" />
          </template>
          <template v-else>
            <ul v-if="items.length > 0" class="mon-endpoint-list" data-testid="requests-endpoints">
              <li v-for="endpoint in items" :key="endpoint.endpointId">
                <button
                  type="button"
                  :class="[
                    'mon-endpoint',
                    { 'mon-endpoint--selected': selectedEndpointId === endpoint.endpointId },
                  ]"
                  :aria-pressed="selectedEndpointId === endpoint.endpointId"
                  @click="selectEndpoint(endpoint.endpointId)"
                >
                  <span class="mon-method">{{ endpoint.method }}</span>
                  <span class="mon-url">{{ endpoint.url }}</span>
                  <span class="mon-meta">{{ endpoint.sampleCount }} 个样本</span>
                </button>
              </li>
            </ul>
            <p v-else class="mon-hint">窗口内没有接口数据。</p>
            <p v-if="state.endpoints.data.totalCount !== undefined" class="mon-meta">
              共 {{ state.endpoints.data.totalCount }} 个接口
            </p>
            <AppTechnicalDetails v-if="state.endpoints.kind === 'available'" summary="列表技术状态"
              >totalCountStatus: {{ state.endpoints.data.totalCountStatus }}</AppTechnicalDetails
            >
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
        </div>
      </AppSection>

      <div data-testid="investigation-detail">
        <AppSection title="请求证据" data-testid="requests-summary">
          <template v-if="state.summary.kind !== 'available'">
            <SectionNotice :view="state.summary" />
          </template>
          <template v-else>
            <dl v-if="state.summary.data.methods.length > 0" class="mon-inline">
              <div v-for="method in state.summary.data.methods" :key="method.method">
                <dt>{{ method.method }}</dt>
                <dd>
                  {{ method.observedCount }} 次
                  <span class="mon-meta"
                    >（失败 {{ method.failureCount }} · 慢 {{ method.slowCount }} · 最大
                    {{ method.durationMaxMs }}ms）</span
                  >
                </dd>
              </div>
            </dl>
            <p v-else class="mon-hint">窗口内没有请求指标。</p>
            <p v-if="state.summary.data.dataThrough" class="mon-meta">
              数据至 {{ formatUtc(state.summary.data.dataThrough)
              }}<template v-if="state.summary.data.isPartial"> · 部分结果</template>
            </p>
          </template>
        </AppSection>

        <AppSection title="已选接口" class="investigation-detail-section">
          <template v-if="selectedEndpoint === null">
            <p class="mon-hint">选择左侧接口以查看该接口已返回的样本、结果和完整性说明。</p>
          </template>
          <template v-else>
            <p class="selected-endpoint__identity">
              <span class="mon-method">{{ selectedEndpoint.method }}</span>
              {{ selectedEndpoint.url }}
            </p>
            <p class="mon-meta">
              {{ selectedEndpoint.sampleCount }} 个样本<template
                v-if="selectedEndpoint.outcomeCounts.length > 0"
              >
                ·
                {{
                  selectedEndpoint.outcomeCounts
                    .map((outcome) => `${outcome.outcome} ${outcome.count}`)
                    .join(' · ')
                }}</template
              ><template v-if="selectedEndpoint.dataThrough !== undefined">
                · 数据至 {{ formatUtc(selectedEndpoint.dataThrough) }}</template
              ><template v-if="selectedEndpoint.isPartial"> · 部分结果</template
              ><template v-if="!selectedEndpoint.completeness.bounded"> · 采样不受限</template>
            </p>
            <AppTechnicalDetails summary="技术详情"
              >endpointId: {{ selectedEndpoint.endpointId }}\ncompletenessSource:
              {{ selectedEndpoint.completeness.source }}</AppTechnicalDetails
            >
          </template>
        </AppSection>

        <AppSection
          title="百分位"
          class="investigation-detail-section"
          data-testid="requests-series-unavailable"
        >
          <SectionNotice :view="state.percentiles" />
        </AppSection>
      </div>
    </div>
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
  width: 100%;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
  padding: var(--space-3);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.mon-endpoint:hover,
.mon-endpoint--selected {
  border-color: var(--color-action-primary);
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
  border-radius: var(--radius-control);
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
.investigation-workspace {
  display: grid;
  grid-template-columns: minmax(260px, 0.85fr) minmax(0, 1.35fr);
  align-items: start;
  gap: var(--space-4);
}
.investigation-detail-section {
  margin-top: var(--space-4);
}
.selected-endpoint__identity {
  margin: 0 0 var(--space-2);
  font-weight: 600;
}
@media (max-width: 800px) {
  .investigation-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
