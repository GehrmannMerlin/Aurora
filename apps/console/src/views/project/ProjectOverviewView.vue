<script setup lang="ts">
/** C2: server authority first; independent query evidence follows. */
import { computed, onMounted, ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import {
  actionTargetHref,
  actionTargetLabel,
  summaryDisplay,
  type DiagnosisData,
} from '../../monitoring/diagnosis.js';
import { formatUtc } from '../../monitoring/format.js';
import {
  fetchDataStatus,
  fetchIssueList,
  fetchPerformancePages,
  fetchRequestEndpoints,
  type IssueListData,
  type PerformancePagesData,
  type RequestEndpointsData,
} from '../../monitoring/queries.js';
import { defaultTimeRange } from '../../monitoring/time-range.js';
import AppLink from '../../components/aurora/AppLink.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppSection from '../../components/aurora/AppSection.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import AppTechnicalDetails from '../../components/aurora/AppTechnicalDetails.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';
import { buildOverviewState, type OverviewState } from './overview-view-model.js';

const route = useRoute();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const scope = { organizationId, projectId };
const window = defaultTimeRange();

interface SectionSource<T> {
  readonly data: ShallowRef<T | null>;
  readonly loading: Ref<boolean>;
  readonly error: Ref<string | null>;
}

function makeSource<T>(): SectionSource<T> {
  return { data: shallowRef<T | null>(null), loading: ref(false), error: ref<string | null>(null) };
}

async function loadSection<T>(source: SectionSource<T>, loader: () => Promise<T>): Promise<void> {
  source.loading.value = true;
  source.error.value = null;
  try {
    source.data.value = await loader();
  } catch (caught) {
    source.data.value = null;
    source.error.value = describeRequestError(caught);
  } finally {
    source.loading.value = false;
  }
}

const diagnosis = makeSource<DiagnosisData>();
const issueList = makeSource<IssueListData>();
const requests = makeSource<RequestEndpointsData>();
const performance = makeSource<PerformancePagesData>();

function refresh(): void {
  void loadSection(diagnosis, () => fetchDataStatus(scope));
  void loadSection(issueList, () => fetchIssueList(scope, { timeRange: window }));
  void loadSection(requests, () => fetchRequestEndpoints(scope, { timeRange: window }));
  void loadSection(performance, () => fetchPerformancePages(scope));
}

onMounted(refresh);

const state = computed<OverviewState>(() =>
  buildOverviewState({
    diagnosisLoading: diagnosis.loading.value,
    diagnosisError: diagnosis.error.value,
    diagnosis: diagnosis.data.value,
    issueListLoading: issueList.loading.value,
    issueListError: issueList.error.value,
    issueList: issueList.data.value,
    requestsLoading: requests.loading.value,
    requestsError: requests.error.value,
    requests: requests.data.value,
    performanceLoading: performance.loading.value,
    performanceError: performance.error.value,
    performance: performance.data.value,
  }),
);
const authority = computed(() =>
  state.value.summary.kind === 'available' ? summaryDisplay(state.value.summary.data) : null,
);
const actionTargets = computed(() =>
  state.value.actions
    .map((target) => ({ target, href: actionTargetHref(target) }))
    .filter(
      (entry): entry is { target: (typeof state.value.actions)[number]; href: string } =>
        entry.href !== null,
    ),
);
const issuesHref = computed(() =>
  actionTargetHref({
    routeId: 'project.issues',
    pathParams: { organizationId, projectId },
    query: {},
  }),
);

function metricLabel(name: string): string {
  return name === 'page_load' ? '页面加载耗时' : name.toUpperCase();
}
function metricUnit(unit: string): string {
  return unit === 'millisecond' ? 'ms' : '';
}
</script>

<template>
  <section class="au-surface mon-workspace" data-testid="project-overview-view">
    <AppPageHeader title="项目概览" description="从权威接收状态开始核对，再查看各项独立证据。">
      <template #actions>
        <button
          type="button"
          class="au-button"
          :disabled="diagnosis.loading.value"
          @click="refresh"
        >
          刷新证据
        </button>
      </template>
    </AppPageHeader>

    <AppSection
      title="当前数据接收状态"
      description="此状态由服务端组合；不会由页面计数或本地缓存推断。"
      :tone="authority?.tone ?? 'neutral'"
      test-id="overview-status"
    >
      <SectionNotice v-if="state.summary.kind !== 'available'" :view="state.summary" />
      <template v-else-if="authority !== null">
        <div class="mon-authority-line">
          <AppStatusBadge :tone="authority.tone">{{ authority.label }}</AppStatusBadge>
          <p v-if="authority.causeLabel" class="mon-note">原因：{{ authority.causeLabel }}</p>
        </div>
        <p class="mon-meta">服务端组合时刻（UTC）：{{ formatUtc(state.summary.data.asOf) }}</p>
        <AppTechnicalDetails summary="技术详情">
          状态键: {{ state.summary.data.status }}
          <template v-if="state.summary.data.primaryCause"
            >\n原因键: {{ state.summary.data.primaryCause }}</template
          >
        </AppTechnicalDetails>
      </template>
    </AppSection>

    <section class="mon-evidence-grid" data-testid="overview-evidence" aria-label="项目证据">
      <AppSection title="问题" description="当前查询窗口中的问题事实。">
        <SectionNotice v-if="state.issues.kind !== 'available'" :view="state.issues" />
        <template v-else>
          <p class="mon-count-line">
            {{
              state.issues.data.totalCountStatus === 'available'
                ? state.issues.data.totalCount
                : '—'
            }}
            <span class="mon-meta">当前窗口内问题总数</span>
          </p>
          <p v-if="state.issues.data.totalCountStatus !== 'available'" class="mon-note">
            总数不可用。
          </p>
          <AppLink v-if="issuesHref !== null" :to="issuesHref">查看问题列表</AppLink>
        </template>
      </AppSection>

      <AppSection title="请求证据" description="已聚合的请求观察结果。">
        <SectionNotice v-if="state.requests.kind !== 'available'" :view="state.requests" />
        <template v-else>
          <dl v-if="state.requests.data.methods.length > 0" class="mon-inline">
            <div v-for="method in state.requests.data.methods" :key="method.method">
              <dt>{{ method.method }}</dt>
              <dd>
                {{ method.observedCount }} 次
                <span class="mon-meta"
                  >失败 {{ method.failureCount }} · 慢 {{ method.slowCount }}</span
                >
              </dd>
            </div>
          </dl>
          <p v-else class="mon-note">窗口内没有请求指标。</p>
          <p v-if="state.requests.data.dataThrough" class="mon-meta">
            数据截止（UTC）：{{ formatUtc(state.requests.data.dataThrough)
            }}<template v-if="state.requests.data.isPartial"> · 部分结果</template>
          </p>
        </template>
      </AppSection>

      <AppSection title="性能证据" description="已有查询支持的性能聚合事实。">
        <SectionNotice v-if="state.performance.kind !== 'available'" :view="state.performance" />
        <template v-else>
          <dl v-if="state.performance.data.metrics.length > 0" class="mon-inline">
            <div v-for="metric in state.performance.data.metrics" :key="metric.metricName">
              <dt>{{ metricLabel(metric.metricName) }}</dt>
              <dd>
                {{ metric.mean }} {{ metricUnit(metric.unit) }}
                <span class="mon-meta">样本 {{ metric.observedCount }}</span>
              </dd>
            </div>
          </dl>
          <p v-else class="mon-note">窗口内没有性能指标。</p>
          <p v-if="state.performance.data.dataThrough" class="mon-meta">
            数据截止（UTC）：{{ formatUtc(state.performance.data.dataThrough)
            }}<template v-if="state.performance.data.isPartial"> · 部分结果</template>
          </p>
        </template>
      </AppSection>

      <AppSection title="最近数据" description="接收与处理是彼此独立的阶段事实。">
        <SectionNotice v-if="state.recent.kind !== 'available'" :view="state.recent" />
        <dl v-else class="mon-inline">
          <div>
            <dt>最近接收</dt>
            <dd>
              {{ state.recent.data.receivedCount
              }}<span v-if="state.recent.data.latestReceivedAt" class="mon-meta">
                · {{ formatUtc(state.recent.data.latestReceivedAt) }}</span
              >
            </dd>
          </div>
          <div>
            <dt>最近已处理</dt>
            <dd>
              {{ state.recent.data.processedCount
              }}<span v-if="state.recent.data.latestProcessedAt" class="mon-meta">
                · {{ formatUtc(state.recent.data.latestProcessedAt) }}</span
              >
            </dd>
          </div>
        </dl>
      </AppSection>

      <AppSection title="可查询证据" description="只有进入处理存储的证据才能查询。">
        <SectionNotice v-if="state.queryable.kind !== 'available'" :view="state.queryable" />
        <dl v-else class="mon-inline">
          <div>
            <dt>错误事件</dt>
            <dd>{{ state.queryable.data.errorOccurrences }}</dd>
          </div>
          <div>
            <dt>请求指标桶</dt>
            <dd>{{ state.queryable.data.requestMetricBuckets }}</dd>
          </div>
          <div>
            <dt>性能指标桶</dt>
            <dd>{{ state.queryable.data.performanceMetricBuckets }}</dd>
          </div>
        </dl>
      </AppSection>
    </section>

    <AppSection
      v-if="actionTargets.length > 0"
      title="可执行行动"
      description="仅显示服务端已授权的目标。"
      test-id="overview-actions"
    >
      <ul class="mon-actions">
        <li v-for="entry in actionTargets" :key="entry.href">
          <AppLink :to="entry.href">{{ actionTargetLabel(entry.target.routeId) }}</AppLink>
        </li>
      </ul>
    </AppSection>
  </section>
</template>

<style scoped>
.mon-workspace {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.mon-authority-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.mon-note,
.mon-meta {
  color: var(--color-text-secondary);
}
.mon-note {
  margin: var(--space-2) 0 0;
}
.mon-meta {
  font-size: 12px;
}
.mon-count-line {
  margin: 0 0 var(--space-2);
  font-size: 24px;
  font-weight: 650;
  color: var(--color-text-primary);
}
.mon-evidence-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
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
  color: var(--color-text-primary);
  font-weight: 600;
}
.mon-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.au-button {
  min-height: var(--control-height);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
  background: var(--color-surface-bg);
  color: var(--color-text-primary);
  font: inherit;
  cursor: pointer;
}
.au-button:disabled {
  cursor: default;
  opacity: 0.6;
}
@media (max-width: 700px) {
  .mon-evidence-grid {
    grid-template-columns: 1fr;
  }
}
</style>
