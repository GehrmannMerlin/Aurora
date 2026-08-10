<script setup lang="ts">
/**
 * C2 项目概览（`project.overview`，PLT-05）。
 *
 * 第一层权威状态与原因只取 `diagnosticsGetDataStatus`（DAT-20）服务端组合的
 * `summary`（receiving/processing/blocked/not_receiving/unknown）；问题/请求/
 * 性能证据来自 DAT-15/16/17 真实投影。后端未提供的能力（告警摘要、影响用户
 * 估算、环境/发布维度、Overview 复合状态 normal/abnormal/no_data）以
 * `unavailable` 诚实表达，不以零值或“正常”代替。
 */
import { computed, onMounted, ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { actionTargetHref, type DiagnosisData } from '../../monitoring/diagnosis.js';
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
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';
import { buildOverviewState, type OverviewState } from './overview-view-model.js';

const route = useRoute();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');

const scope = { organizationId, projectId };
// One deterministic default window per page lifetime keeps the request-cache key
// stable while still sending the required `timeRange` for DAT-15/16.
const window = defaultTimeRange();

interface SectionSource<T> {
  readonly data: ShallowRef<T | null>;
  readonly loading: Ref<boolean>;
  readonly error: Ref<string | null>;
}

function makeSource<T>(): SectionSource<T> {
  return {
    data: shallowRef<T | null>(null),
    loading: ref(false),
    error: ref<string | null>(null),
  };
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

// The authority diagnosis and each auxiliary evidence block load independently
// (UX §7.17: any missing auxiliary evidence is marked per block; one failure
// never hides the authority status or the other evidence).
const diagnosis = makeSource<DiagnosisData>();
const issueList = makeSource<IssueListData>();
const requests = makeSource<RequestEndpointsData>();
const performance = makeSource<PerformancePagesData>();

onMounted(() => {
  void loadSection(diagnosis, () => fetchDataStatus(scope));
  void loadSection(issueList, () => fetchIssueList(scope, { timeRange: window }));
  void loadSection(requests, () => fetchRequestEndpoints(scope, { timeRange: window }));
  void loadSection(performance, () => fetchPerformancePages(scope));
});

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

const actionTargets = computed(() =>
  state.value.actions
    .map((target) => ({ target, href: actionTargetHref(target) }))
    .filter(
      (entry): entry is { target: (typeof state.value.actions)[number]; href: string } =>
        entry.href !== null,
    ),
);

const issuesHref = computed(() => {
  const resolved = actionTargetHref({
    routeId: 'project.issues',
    pathParams: { organizationId, projectId },
    query: {},
  });
  return resolved;
});

function metricLabel(name: string): string {
  if (name === 'page_load') return '页面加载耗时';
  return name.toUpperCase();
}

function metricUnit(unit: string): string {
  return unit === 'millisecond' ? 'ms' : '';
}
</script>

<template>
  <section class="au-surface" data-testid="project-overview-view">
    <AppPageHeader title="项目概览" />

    <section class="mon-block" data-testid="overview-status">
      <h2 class="mon-title">权威数据接收状态</h2>
      <template v-if="state.summary.kind !== 'available'">
        <SectionNotice :view="state.summary" />
      </template>
      <template v-else>
        <AppStatusBadge :tone="state.summary.data.status === 'receiving' ? 'success' : 'warning'">
          {{ state.summary.data.status }}
        </AppStatusBadge>
        <p v-if="state.summary.data.primaryCause" class="mon-note">
          原因：{{ state.summary.data.primaryCause }}
        </p>
        <p class="mon-meta">服务端组合时刻：{{ formatUtc(state.summary.data.asOf) }}</p>
      </template>
    </section>

    <section class="mon-block" data-testid="overview-issues">
      <h2 class="mon-title">问题</h2>
      <template v-if="state.issues.kind !== 'available'">
        <SectionNotice :view="state.issues" />
      </template>
      <template v-else>
        <p class="mon-count-line">
          {{ state.issues.data.totalCount }}
          <span class="mon-meta">
            当前窗口内问题总数（{{ state.issues.data.totalCountStatus }}）
          </span>
        </p>
        <AppLink v-if="issuesHref !== null" :to="issuesHref">进入问题列表</AppLink>
      </template>
    </section>

    <section class="mon-block" data-testid="overview-requests">
      <h2 class="mon-title">请求证据</h2>
      <template v-if="state.requests.kind !== 'available'">
        <SectionNotice :view="state.requests" />
      </template>
      <template v-else>
        <dl v-if="state.requests.data.methods.length > 0" class="mon-inline">
          <div v-for="method in state.requests.data.methods" :key="method.method">
            <dt>{{ method.method }}</dt>
            <dd>
              {{ method.observedCount }} 次
              <span class="mon-meta">
                （失败 {{ method.failureCount }} · 慢 {{ method.slowCount }}）
              </span>
            </dd>
          </div>
        </dl>
        <p v-else class="mon-hint">窗口内没有请求指标。</p>
        <p v-if="state.requests.data.dataThrough" class="mon-meta">
          数据至 {{ formatUtc(state.requests.data.dataThrough) }}
          <template v-if="state.requests.data.isPartial"> · 部分结果</template>
        </p>
      </template>
    </section>

    <section class="mon-block" data-testid="overview-performance">
      <h2 class="mon-title">性能证据</h2>
      <template v-if="state.performance.kind !== 'available'">
        <SectionNotice :view="state.performance" />
      </template>
      <template v-else>
        <dl v-if="state.performance.data.metrics.length > 0" class="mon-inline">
          <div v-for="metric in state.performance.data.metrics" :key="metric.metricName">
            <dt>{{ metricLabel(metric.metricName) }}</dt>
            <dd>
              {{ metric.mean }} {{ metricUnit(metric.unit) }}
              <span class="mon-meta">（样本 {{ metric.observedCount }}）</span>
            </dd>
          </div>
        </dl>
        <p v-else class="mon-hint">窗口内没有性能指标。</p>
        <p v-if="state.performance.data.dataThrough" class="mon-meta">
          数据至 {{ formatUtc(state.performance.data.dataThrough) }}
          <template v-if="state.performance.data.isPartial"> · 部分结果</template>
        </p>
      </template>
    </section>

    <section class="mon-block" data-testid="overview-recent">
      <h2 class="mon-title">最近数据与可信度</h2>
      <template v-if="state.recent.kind !== 'available'">
        <SectionNotice :view="state.recent" />
      </template>
      <template v-else>
        <dl class="mon-inline">
          <div>
            <dt>最近接收</dt>
            <dd>
              {{ state.recent.data.receivedCount }}
              <span v-if="state.recent.data.latestReceivedAt" class="mon-meta">
                （{{ formatUtc(state.recent.data.latestReceivedAt) }}）
              </span>
            </dd>
          </div>
          <div>
            <dt>最近已处理</dt>
            <dd>
              {{ state.recent.data.processedCount }}
              <span v-if="state.recent.data.latestProcessedAt" class="mon-meta">
                （{{ formatUtc(state.recent.data.latestProcessedAt) }}）
              </span>
            </dd>
          </div>
        </dl>
      </template>
    </section>

    <section class="mon-block" data-testid="overview-queryable">
      <h2 class="mon-title">可查询证据</h2>
      <template v-if="state.queryable.kind !== 'available'">
        <SectionNotice :view="state.queryable" />
      </template>
      <template v-else>
        <dl class="mon-inline">
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
      </template>
    </section>

    <section v-if="actionTargets.length > 0" class="mon-block" data-testid="overview-actions">
      <h2 class="mon-title">诊断动作</h2>
      <ul class="mon-actions">
        <li v-for="entry in actionTargets" :key="entry.href">
          <AppLink :to="entry.href">{{ entry.target.routeId }}</AppLink>
        </li>
      </ul>
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
.mon-note {
  margin: var(--space-1) 0 0;
  color: var(--color-text-secondary);
}
.mon-meta {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-count-line {
  margin: 0 0 var(--space-1);
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
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
.mon-hint {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
.mon-actions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
</style>
