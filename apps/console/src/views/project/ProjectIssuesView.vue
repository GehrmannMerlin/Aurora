<script setup lang="ts">
/**
 * C3 Issue 列表（`project.issues`，PLT-06）。
 *
 * URL 是筛选/分页的当前权威来源；列表只消费 `issuesListIssues`（DAT-15）真实
 * 投影。`environments`/`releases` 恒 `unavailable`（契约缺口），空窗口 `empty`，
 * 缺失证据不以零值代替。行点击进入 C4 并保留返回上下文。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { formatUtc } from '../../monitoring/format.js';
import { fetchIssueList, type IssueSummary } from '../../monitoring/queries.js';
import { defaultTimeRange } from '../../monitoring/time-range.js';
import type { SectionView } from '../../monitoring/section.js';
import { issueStatusLabel, issuePriorityLabel } from '../../monitoring/issue-workspace.js';
import { resolveRouteTarget } from '../../contracts/route-registry.js';
import AppLink from '../../components/aurora/AppLink.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import AppTechnicalDetails from '../../components/aurora/AppTechnicalDetails.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';
import {
  issueListQuery,
  issueFiltersToQuery,
  mergeIssuePage,
  parseIssueFilters,
  type IssueFilters,
} from './issues-view-model.js';

const route = useRoute();
const router = useRouter();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');

const window = defaultTimeRange();

const items = ref<readonly IssueSummary[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const countView = ref<SectionView<{ totalCount: number; totalCountStatus: string }>>({
  kind: 'loading',
});

const filters = ref<IssueFilters>(parseIssueFilters(route.query));
const selectedIssueIds = ref<readonly string[]>([]);
const scope = { organizationId, projectId };
const selectedCount = computed(() => selectedIssueIds.value.length);

async function load(reset: boolean): Promise<void> {
  loading.value = true;
  error.value = null;
  if (reset) {
    items.value = [];
    nextCursor.value = null;
    selectedIssueIds.value = [];
  }
  try {
    const page = await fetchIssueList(
      scope,
      issueListQuery(filters.value, window, reset ? undefined : (nextCursor.value ?? undefined)),
    );
    const merged = mergeIssuePage(reset ? [] : items.value, page);
    items.value = merged.items;
    nextCursor.value = merged.nextCursor;
    countView.value = merged.view;
  } catch (caught) {
    error.value = describeRequestError(caught);
    if (reset) countView.value = { kind: 'error', message: error.value };
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load(true);
});

/** Update a filter: `null` clears it, `undefined` keeps the current value. */
function setFilters(
  update: Partial<Record<'status' | 'priority' | 'assigneeAccountId', string | null>>,
): void {
  const next: IssueFilters = {};
  for (const key of ['status', 'priority', 'assigneeAccountId'] as const) {
    const override = update[key];
    if (override !== undefined && override !== null) {
      (next as Record<string, string>)[key] = override;
    } else if (override === undefined) {
      const current = filters.value[key];
      if (current !== undefined) (next as Record<string, string>)[key] = current;
    }
  }
  filters.value = next;
  const query = issueFiltersToQuery(next, window);
  void router.replace({ query });
  void load(true);
}

function statusSelect(event: Event): void {
  const next = (event.target as HTMLSelectElement).value;
  setFilters({ status: next === '' ? null : next });
}

function prioritySelect(event: Event): void {
  const next = (event.target as HTMLSelectElement).value;
  setFilters({ priority: next === '' ? null : next });
}

function assigneeInput(event: Event): void {
  const next = (event.target as HTMLInputElement).value.trim();
  setFilters({ assigneeAccountId: next === '' ? null : next });
}

function issueHref(issueId: string): string {
  const resolved = resolveRouteTarget({
    routeId: 'project.issue-detail',
    pathParams: { organizationId, projectId, issueId },
    query: {},
  });
  return resolved.path ?? '/not-found';
}

function onLoadMore(): void {
  void load(false);
}

function isSelected(issueId: string): boolean {
  return selectedIssueIds.value.includes(issueId);
}

function toggleIssueSelection(issueId: string, checked: boolean): void {
  selectedIssueIds.value = checked
    ? [...new Set([...selectedIssueIds.value, issueId])]
    : selectedIssueIds.value.filter((current) => current !== issueId);
}

function clearSelection(): void {
  selectedIssueIds.value = [];
}
</script>

<template>
  <section class="au-surface" data-testid="project-issues-view">
    <AppPageHeader title="问题" description="按状态、优先级或负责人筛选当前时间窗口内的问题。" />

    <div class="issues-query-toolbar" data-testid="issues-query-toolbar">
      <label class="fil">
        状态
        <select
          :value="filters.status ?? ''"
          @change="statusSelect($event)"
          data-testid="filter-status"
        >
          <option value="">全部</option>
          <option value="open">待处理</option>
          <option value="in_progress">处理中</option>
          <option value="resolved">已解决</option>
          <option value="ignored">已忽略</option>
        </select>
      </label>
      <label class="fil">
        优先级
        <select
          :value="filters.priority ?? ''"
          @change="prioritySelect($event)"
          data-testid="filter-priority"
        >
          <option value="">全部</option>
          <option value="urgent">紧急</option>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">低</option>
        </select>
      </label>
      <label class="fil">
        负责人账号
        <input
          type="text"
          :value="filters.assigneeAccountId ?? ''"
          @change="assigneeInput($event)"
          placeholder="accountId"
          data-testid="filter-assignee"
        />
      </label>
    </div>

    <div
      v-if="loading && items.length === 0"
      class="mon-hint"
      role="status"
      data-testid="issues-loading"
    >
      正在加载问题…
    </div>
    <SectionNotice
      v-if="error !== null && items.length === 0"
      :view="{ kind: 'error', message: error }"
    />
    <SectionNotice v-if="countView.kind === 'empty'" :view="countView" />

    <section
      class="issues-results-surface"
      data-testid="issues-results-surface"
      aria-label="问题结果"
    >
      <div class="issues-results-surface__summary">
        <template v-if="countView.kind === 'available'">
          <p class="mon-meta" data-testid="issues-total">
            共 {{ countView.data.totalCount }} 个问题
          </p>
          <AppTechnicalDetails summary="总量技术状态"
            >totalCountStatus: {{ countView.data.totalCountStatus }}</AppTechnicalDetails
          >
        </template>
        <p class="mon-meta" data-testid="issues-selection-summary">
          当前页已选择 {{ selectedCount }} 个问题
        </p>
      </div>
      <div v-if="selectedCount > 0" class="issues-selection-bar" data-testid="issues-selection-bar">
        <p>已选择 {{ selectedCount }} 个当前页问题。批量处理尚未提供；可打开问题执行已授权操作。</p>
        <button type="button" class="au-button" @click="clearSelection">清除选择</button>
      </div>
      <ul v-if="items.length > 0" class="mon-issue-list" data-testid="issue-list">
        <li v-for="issue in items" :key="issue.issueId" class="mon-issue-item">
          <label class="issues-select">
            <input
              type="checkbox"
              :checked="isSelected(issue.issueId)"
              :aria-label="`选择问题：${issue.title}`"
              @change="
                toggleIssueSelection(issue.issueId, ($event.target as HTMLInputElement).checked)
              "
            />
          </label>
          <div class="mon-issue-item__content">
            <AppLink :to="issueHref(issue.issueId)" class="mon-issue-title">{{
              issue.title
            }}</AppLink>
            <div class="mon-issue-meta">
              <AppStatusBadge :tone="issue.status === 'open' ? 'warning' : 'neutral'">
                {{ issueStatusLabel(issue.status) }}
              </AppStatusBadge>
              <span>{{ issue.occurrenceCount }} 次</span>
              <span v-if="issue.priority !== undefined"
                >优先级 {{ issuePriorityLabel(issue.priority) }}</span
              >
              <span v-if="issue.assigneeAccountId !== undefined"
                >负责人 {{ issue.assigneeAccountId }}</span
              >
              <span class="mon-meta"
                >首次 {{ formatUtc(issue.firstSeenAt) }} · 最近
                {{ formatUtc(issue.lastSeenAt) }}</span
              >
            </div>
            <AppTechnicalDetails summary="技术详情"
              >issueId: {{ issue.issueId }}</AppTechnicalDetails
            >
          </div>
        </li>
      </ul>
      <div v-if="nextCursor !== null" class="mon-actions-row">
        <button
          type="button"
          class="au-button"
          data-testid="issues-load-more"
          :disabled="loading"
          @click="onLoadMore"
        >
          加载更多
        </button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.issues-query-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.fil {
  display: inline-flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--color-text-secondary);
  font-size: 12px;
}
.fil select,
.fil input {
  min-height: var(--control-height);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  font: inherit;
}
.mon-hint {
  color: var(--color-text-secondary);
}
.mon-meta {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-issue-list {
  list-style: none;
  margin: 0;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.mon-issue-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  padding: var(--space-3);
}
.mon-issue-item__content {
  min-width: 0;
  flex: 1;
}
.issues-select {
  padding-top: 2px;
}
.issues-results-surface {
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-surface);
  background-color: var(--color-surface-bg);
}
.issues-results-surface__summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border-default);
}
.issues-selection-bar {
  position: sticky;
  top: var(--space-2);
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border-default);
  background-color: var(--color-surface-muted);
}
.issues-selection-bar p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}
.mon-issue-title {
  font-weight: 600;
  color: var(--color-text-primary);
}
.mon-issue-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
  color: var(--color-text-secondary);
  font-size: 12px;
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
