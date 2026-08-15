<script setup lang="ts">
/**
 * C4 Issue 详情（`project.issue-detail`，PLT-06）。
 *
 * 只读区（`issuesGetIssueDetail`：issue/samples/activity，样本与活动为安全投影）
 * + 写操作区（DAT-14 生命周期 Command：状态/优先级/负责人/备注）。前端**不隐藏
 * 按钮**——每次 Command 由服务端重鉴权（`read_only` → 403 就地显示）、`version`
 * 乐观并发（`conflict` → 提示刷新）、`idempotencyKey` + CSRF。合并 UI deferred。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { ApiError } from '../../api/errors.js';
import { invalidateScope } from '../../api/query.js';
import { formatUtc } from '../../monitoring/format.js';
import { fetchIssueDetail, type IssueDetailData } from '../../monitoring/queries.js';
import {
  createIssueNote,
  deleteIssueNote,
  updateIssueAssignee,
  updateIssuePriority,
  updateIssueState,
} from '../../monitoring/commands.js';
import { useSessionStore } from '../../stores/session.js';
import { issuePriorityLabel, issueStatusLabel } from '../../monitoring/issue-workspace.js';
import { buildIssueDetailView, type IssueDetailViewState } from './issue-detail-view-model.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppSection from '../../components/aurora/AppSection.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import AppTechnicalDetails from '../../components/aurora/AppTechnicalDetails.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const issueId = String(route.params.issueId ?? '');
const scope = { organizationId, projectId };

const detail = ref<IssueDetailData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const busy = ref<string | null>(null);
const actionError = ref<string | null>(null);
const assigneeInput = ref('');
const noteInput = ref('');
const priorityInput = ref('high');

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    detail.value = await fetchIssueDetail(scope, issueId);
  } catch (caught) {
    detail.value = null;
    error.value = describeRequestError(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

const state = computed<IssueDetailViewState>(() =>
  buildIssueDetailView({
    issue: detail.value?.issue ?? null,
    samples: detail.value?.samples ?? null,
    activity: detail.value?.activity ?? null,
  }),
);

const currentVersion = computed<number>(() => {
  if (state.value.issue.kind === 'available') return state.value.issue.data.version;
  return 1;
});

function describeCommandError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.code === 'authorization') return '你没有处理该问题的权限。';
    if (caught.code === 'version_conflict' || caught.code === 'idempotency_conflict') {
      return '问题版本已变化，请刷新后重试。';
    }
    if (caught.code === 'field_validation' || caught.code === 'state_machine_conflict') {
      return '该状态转移不允许。';
    }
  }
  return describeRequestError(caught);
}

async function run(action: string, task: () => Promise<unknown>): Promise<void> {
  if (busy.value !== null || session.csrf === null) return;
  busy.value = action;
  actionError.value = null;
  try {
    await task();
    // The Command changed the authoritative detail; drop the project-scope cache
    // so the refetch returns the new version/status, not a stale snapshot.
    invalidateScope({ type: 'project', id: projectId });
    await load();
  } catch (caught) {
    actionError.value = describeCommandError(caught);
  } finally {
    busy.value = null;
  }
}

function onMarkInProgress(): void {
  void run('in_progress', () =>
    updateIssueState(
      scope,
      issueId,
      { status: 'in_progress', version: currentVersion.value },
      { csrf: session.csrf ?? '' },
    ),
  );
}

function onResolve(): void {
  void run('resolved', () =>
    updateIssueState(
      scope,
      issueId,
      {
        status: 'resolved',
        version: currentVersion.value,
        resolution: { reason: 'by_time', resolvedAtIso: new Date().toISOString() },
      },
      { csrf: session.csrf ?? '' },
    ),
  );
}

function onIgnore(): void {
  void run('ignored', () =>
    updateIssueState(
      scope,
      issueId,
      { status: 'ignored', version: currentVersion.value },
      { csrf: session.csrf ?? '' },
    ),
  );
}

function onReopen(): void {
  void run('reopen', () =>
    updateIssueState(
      scope,
      issueId,
      { status: 'open', version: currentVersion.value },
      { csrf: session.csrf ?? '' },
    ),
  );
}

function onAssign(): void {
  const assigneeAccountId = assigneeInput.value.trim();
  const params: { assigneeAccountId?: string; version: number } = {
    version: currentVersion.value,
  };
  if (assigneeAccountId !== '') params.assigneeAccountId = assigneeAccountId;
  void run('assign', () =>
    updateIssueAssignee(scope, issueId, params, { csrf: session.csrf ?? '' }),
  );
}

function onClearAssignee(): void {
  void run('clear-assignee', () =>
    updateIssueAssignee(
      scope,
      issueId,
      { version: currentVersion.value },
      { csrf: session.csrf ?? '' },
    ),
  );
}

function onSetPriority(): void {
  void run('priority', () =>
    updateIssuePriority(
      scope,
      issueId,
      { priority: priorityInput.value, version: currentVersion.value },
      { csrf: session.csrf ?? '' },
    ),
  );
}

function onClearPriority(): void {
  void run('clear-priority', () =>
    updateIssuePriority(
      scope,
      issueId,
      { version: currentVersion.value },
      { csrf: session.csrf ?? '' },
    ),
  );
}

function onAddNote(): void {
  const content = noteInput.value.trim();
  if (content === '') return;
  void run('note', () =>
    createIssueNote(scope, issueId, { content }, { csrf: session.csrf ?? '' }).then(() => {
      noteInput.value = '';
    }),
  );
}

function onDeleteNote(noteId: string): void {
  void run('delete-note', () =>
    deleteIssueNote(scope, issueId, noteId, { csrf: session.csrf ?? '' }),
  );
}

function onBack(): void {
  void router.back();
}
</script>

<template>
  <section class="au-surface" data-testid="project-issue-detail-view">
    <AppPageHeader
      :title="state.issue.kind === 'available' ? state.issue.data.title : '问题详情'"
    />
    <p class="mon-back">
      <button type="button" class="au-linklike" @click="onBack">← 返回问题列表</button>
    </p>

    <SectionNotice v-if="loading" :view="{ kind: 'loading' }" />
    <SectionNotice
      v-if="error !== null && detail === null"
      :view="{ kind: 'error', message: error }"
    />

    <template v-if="state.issue.kind !== 'available' && detail !== null">
      <SectionNotice :view="state.issue" />
    </template>

    <template v-if="state.issue.kind === 'available'">
      <AppSection title="问题身份" class="mon-block" data-testid="issue-identity">
        <div class="mon-meta">
          <AppStatusBadge
            :tone="state.issue.data.status === 'open' ? 'warning' : 'neutral'"
            data-testid="issue-status"
          >
            {{ issueStatusLabel(state.issue.data.status) }}
          </AppStatusBadge>
          <span>{{ state.issue.data.category }}</span>
          <span
            >{{ state.issue.data.occurrenceCount }} 次发生 ·
            {{ state.issue.data.sampleCount }} 个样本</span
          >
          <span
            >首次 {{ formatUtc(state.issue.data.firstSeenAt) }} · 最近
            {{ formatUtc(state.issue.data.lastSeenAt) }}</span
          >
          <span v-if="state.issue.data.priority !== undefined"
            >优先级 {{ issuePriorityLabel(state.issue.data.priority) }}</span
          >
          <span v-if="state.issue.data.assigneeAccountId !== undefined">已分配负责人</span>
          <span v-if="state.issue.data.mergedIntoIssueId !== undefined">已合并到其他问题</span>
        </div>
      </AppSection>

      <AppSection title="处理" class="mon-block" data-testid="issue-lifecycle-actions">
        <div class="com-row">
          <button
            type="button"
            class="au-button"
            :disabled="busy !== null || session.csrf === null"
            @click="onMarkInProgress"
          >
            标记处理中
          </button>
          <button
            type="button"
            class="au-button"
            :disabled="busy !== null || session.csrf === null"
            @click="onResolve"
          >
            解决
          </button>
          <button
            type="button"
            class="au-button"
            :disabled="busy !== null || session.csrf === null"
            @click="onIgnore"
          >
            永久忽略
          </button>
          <button
            type="button"
            class="au-button"
            :disabled="busy !== null || session.csrf === null"
            @click="onReopen"
          >
            重新打开
          </button>
        </div>
        <div class="com-row">
          <label class="com">
            负责人账号
            <input
              type="text"
              v-model="assigneeInput"
              placeholder="accountId"
              data-testid="assignee-input"
            />
          </label>
          <button
            type="button"
            class="au-button"
            :disabled="busy !== null || session.csrf === null"
            @click="onAssign"
          >
            分配
          </button>
          <button
            type="button"
            class="au-button"
            :disabled="busy !== null || session.csrf === null"
            @click="onClearAssignee"
          >
            清空
          </button>
        </div>
        <div class="com-row">
          <label class="com">
            优先级
            <select v-model="priorityInput" data-testid="priority-select">
              <option value="urgent">紧急</option>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
          <button
            type="button"
            class="au-button"
            :disabled="busy !== null || session.csrf === null"
            @click="onSetPriority"
          >
            设置
          </button>
          <button
            type="button"
            class="au-button"
            :disabled="busy !== null || session.csrf === null"
            @click="onClearPriority"
          >
            清除
          </button>
        </div>
        <p v-if="actionError !== null" class="com-error" data-testid="command-error" role="alert">
          {{ actionError }}
        </p>
      </AppSection>

      <AppSection title="证据" class="mon-block" data-testid="issue-evidence">
        <p class="mon-meta">
          {{ state.issue.data.occurrenceCount }} 次发生 ·
          {{ state.issue.data.sampleCount }} 个保留样本 · 首次
          {{ formatUtc(state.issue.data.firstSeenAt) }} · 最近
          {{ formatUtc(state.issue.data.lastSeenAt) }}
        </p>
      </AppSection>
    </template>

    <AppSection title="代表样本与堆栈" class="mon-block" data-testid="issue-samples">
      <template v-if="state.samples.kind !== 'available'">
        <SectionNotice :view="state.samples" />
      </template>
      <template v-else>
        <ul v-if="state.samples.data.length > 0" class="mon-sample-list">
          <li v-for="sample in state.samples.data" :key="sample.sampleId" class="mon-sample">
            <span class="mon-meta">代表样本 · {{ formatUtc(sample.occurredAt) }}</span>
            <AppTechnicalDetails summary="样本技术详情"
              >sampleId: {{ sample.sampleId }} sampleKind: {{ sample.sampleKind }} sampleBody:
              {{ JSON.stringify(sample.sampleBody) }}</AppTechnicalDetails
            >
          </li>
        </ul>
        <p v-else class="mon-hint">没有保留的代表样本。</p>
      </template>
    </AppSection>

    <AppSection
      v-if="state.issue.kind === 'available'"
      title="技术字段"
      class="mon-block"
      data-testid="issue-technical-details"
    >
      <AppTechnicalDetails summary="技术详情"
        >issueId: {{ state.issue.data.issueId }} fingerprintVersion:
        {{ state.issue.data.fingerprintVersion }} version:
        {{ state.issue.data.version }}
        <template v-if="state.issue.data.assigneeAccountId !== undefined">
          assigneeAccountId: {{ state.issue.data.assigneeAccountId }}
        </template>
        <template v-if="state.issue.data.mergedIntoIssueId !== undefined">
          mergedIntoIssueId: {{ state.issue.data.mergedIntoIssueId }}
        </template></AppTechnicalDetails
      >
    </AppSection>

    <AppSection title="活动与备注" class="mon-block" data-testid="issue-activity">
      <template v-if="state.activity.kind !== 'available'">
        <SectionNotice :view="state.activity" />
      </template>
      <template v-else>
        <div v-if="state.activity.data.activities.length > 0" class="mon-timeline">
          <div
            v-for="(entry, index) in state.activity.data.activities"
            :key="`${entry.activityType}-${index}`"
            class="mon-tl-item"
          >
            <span class="mon-meta">活动记录 · {{ formatUtc(entry.createdAt) }}</span>
            <AppTechnicalDetails summary="活动技术详情"
              >activityType: {{ entry.activityType }}
              <template v-if="entry.actorAccountId !== undefined">
                actorAccountId: {{ entry.actorAccountId }}
              </template>
              details: {{ JSON.stringify(entry.details) }}</AppTechnicalDetails
            >
          </div>
        </div>
        <p v-else class="mon-hint">暂无活动。</p>
        <ul v-if="state.activity.data.notes.length > 0" class="mon-note-list">
          <li v-for="note in state.activity.data.notes" :key="note.noteId" class="mon-note">
            <div class="mon-note-head">
              <span class="mon-meta">备注 · {{ formatUtc(note.createdAt) }}</span>
              <button
                v-if="
                  note.deletedAt === undefined &&
                  note.content !== undefined &&
                  note.authorAccountId === session.account?.accountId
                "
                type="button"
                class="au-linklike"
                :disabled="busy !== null"
                @click="onDeleteNote(note.noteId)"
              >
                删除
              </button>
            </div>
            <p v-if="note.deletedAt !== undefined" class="mon-hint">（备注已删除）</p>
            <p v-else-if="note.content !== undefined" class="mon-note-body">{{ note.content }}</p>
            <AppTechnicalDetails summary="备注技术详情"
              >noteId: {{ note.noteId }} authorAccountId:
              {{ note.authorAccountId }}</AppTechnicalDetails
            >
          </li>
        </ul>
        <div class="com-row">
          <textarea
            v-model="noteInput"
            class="mon-textarea"
            rows="3"
            placeholder="添加 Markdown 备注"
            data-testid="note-input"
          ></textarea>
          <button
            type="button"
            class="au-button"
            :disabled="busy !== null || session.csrf === null || noteInput.trim() === ''"
            @click="onAddNote"
          >
            添加备注
          </button>
        </div>
      </template>
    </AppSection>
  </section>
</template>

<style scoped>
.mon-back {
  margin: 0 0 var(--space-3);
}
.au-linklike {
  border: none;
  background: none;
  padding: 0;
  color: var(--color-action-primary);
  cursor: pointer;
  font: inherit;
}
.mon-block {
  margin-bottom: var(--space-5);
}
.mon-title {
  margin: 0 0 var(--space-2);
  font-size: 16px;
  color: var(--color-text-primary);
}
.mon-meta {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-hint {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
.com-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.com {
  display: inline-flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--color-text-secondary);
  font-size: 12px;
}
.com input,
.com select,
.mon-textarea {
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  font: inherit;
}
.com input,
.com select {
  min-height: var(--control-height);
  padding: 0 var(--space-2);
}
.mon-textarea {
  padding: var(--space-2);
  min-width: 320px;
}
.com-error {
  color: var(--color-status-danger);
  margin: 0;
}
.mon-sample-list,
.mon-note-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.mon-sample,
.mon-note {
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
  padding: var(--space-3);
}
.mon-code {
  margin: var(--space-1) 0 0;
  padding: var(--space-2);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
  overflow-x: auto;
  background-color: var(--color-surface-bg);
}
.mon-note-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.mon-note-body {
  margin: var(--space-1) 0 0;
  white-space: pre-wrap;
}
.mon-timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-3);
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
</style>
