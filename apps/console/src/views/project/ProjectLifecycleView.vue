<script setup lang="ts">
/**
 * C16 项目生命周期（`project.lifecycle`，PLT-08）。
 *
 * 只消费 `settingsGetProject`（C16 复用其 lifecycle 摘要）与三个独立高风险
 * Command：archive / restore-from-archive / move-to-trash。移入回收站需精确输入
 * 当前权威项目名称 + `resourceVersion` 确认，仅 org manager 可执行（服务端仍
 * 重鉴权）；不与 settings save / archive 共用提交按钮。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { ApiError } from '../../api/errors.js';
import { invalidateScope } from '../../api/query.js';
import { createIdempotencyKey } from '../../api/client.js';
import { formatUtc } from '../../monitoring/format.js';
import { fetchProjectSettings, type ProjectSettingsData } from '../../monitoring/queries.js';
import {
  archiveProject,
  moveProjectToTrash,
  restoreProjectFromArchive,
} from '../../monitoring/commands.js';
import { useSessionStore } from '../../stores/session.js';
import {
  buildLifecycleView,
  canArchive,
  canMoveToTrash,
  canRestoreFromArchive,
  lifecycleStatusLabel,
  trashNameMatches,
} from './lifecycle-view-model.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';

const route = useRoute();
const session = useSessionStore();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const scope = { organizationId, projectId };

const settings = ref<ProjectSettingsData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const busy = ref<string | null>(null);
const actionError = ref<string | null>(null);
const trashNameInput = ref('');

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    settings.value = await fetchProjectSettings(scope);
  } catch (caught) {
    error.value = describeRequestError(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

const state = computed(() =>
  buildLifecycleView({
    loading: loading.value,
    error: error.value,
    project: settings.value?.project ?? null,
  }),
);

const lifecycle = computed(() =>
  state.value.project.kind === 'available' ? state.value.project.data.lifecycle : null,
);
const authoritativeName = computed(() =>
  state.value.project.kind === 'available' ? state.value.project.data.name : '',
);
const resourceVersion = computed(() =>
  state.value.project.kind === 'available' ? state.value.project.data.resourceVersion : '',
);

function describeCommandError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.code === 'authorization') return '你没有执行该生命周期操作的权限。';
    if (caught.code === 'state_machine_conflict') return '当前项目状态不允许该操作。';
    if (caught.code === 'version_conflict') return '项目版本已变化，请刷新后重试。';
  }
  return describeRequestError(caught);
}

async function runAction(key: string, task: () => Promise<unknown>): Promise<void> {
  if (busy.value !== null) return;
  busy.value = key;
  actionError.value = null;
  try {
    await task();
    invalidateScope({ type: 'project', id: projectId });
    await load();
  } catch (caught) {
    actionError.value = describeCommandError(caught);
  } finally {
    busy.value = null;
  }
}

function archive(): void {
  if (!window.confirm('归档后停止接收新事件、告警停止，历史数据保留。确定归档？')) return;
  void runAction('archive', () =>
    archiveProject(scope, { csrf: session.csrf ?? '', idempotencyKey: createIdempotencyKey() }),
  );
}

function restoreFromArchive(): void {
  void runAction('restore', () =>
    restoreProjectFromArchive(scope, {
      csrf: session.csrf ?? '',
      idempotencyKey: createIdempotencyKey(),
    }),
  );
}

function moveToTrash(): void {
  if (busy.value !== null) return;
  if (!trashNameMatches(trashNameInput.value, authoritativeName.value)) {
    actionError.value = '请输入当前权威项目名称以确认。';
    return;
  }
  if (!window.confirm('移入回收站后密钥立即失效、令牌撤销，7 天内可恢复。确定移入回收站？')) return;
  void runAction('trash', () =>
    moveProjectToTrash(
      scope,
      { resourceVersion: resourceVersion.value },
      {
        csrf: session.csrf ?? '',
        idempotencyKey: createIdempotencyKey(),
      },
    ),
  );
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success';
  if (status === 'archived') return 'warning';
  if (status === 'trash' || status === 'deleting') return 'danger';
  return 'neutral';
}
</script>

<template>
  <section class="au-surface" data-testid="project-lifecycle-view">
    <AppPageHeader title="生命周期" />

    <section class="mon-block" data-testid="lifecycle-summary">
      <h2 class="mon-title">当前状态</h2>
      <template v-if="state.project.kind === 'loading'">
        <p class="mon-hint" role="status">正在加载生命周期…</p>
      </template>
      <template v-else-if="state.project.kind !== 'available'">
        <SectionNotice :view="state.project" />
      </template>
      <template v-else>
        <div class="mon-status-row">
          <AppStatusBadge :tone="statusTone(state.project.data.lifecycle.status)">
            {{ lifecycleStatusLabel(state.project.data.lifecycle.status) }}
          </AppStatusBadge>
          <span class="mon-name">{{ state.project.data.name }}</span>
        </div>
        <dl class="mon-dl">
          <template v-if="state.project.data.lifecycle.archivedAt !== undefined">
            <dt>归档时间</dt>
            <dd>{{ formatUtc(state.project.data.lifecycle.archivedAt) }}</dd>
          </template>
          <template v-if="state.project.data.lifecycle.trashedAt !== undefined">
            <dt>移入回收站时间</dt>
            <dd>{{ formatUtc(state.project.data.lifecycle.trashedAt) }}</dd>
          </template>
          <template v-if="state.project.data.lifecycle.recoverableUntil !== undefined">
            <dt>可恢复至</dt>
            <dd>{{ formatUtc(state.project.data.lifecycle.recoverableUntil) }}</dd>
          </template>
        </dl>
      </template>
    </section>

    <template v-if="lifecycle !== null">
      <section
        v-if="canArchive(lifecycle.status)"
        class="mon-block"
        data-testid="lifecycle-archive"
      >
        <h2 class="mon-title">归档项目</h2>
        <p class="mon-hint">归档后停止接收新事件，告警停止，历史数据保留；可随时从归档恢复。</p>
        <button
          type="button"
          class="au-button au-button--danger"
          :disabled="busy !== null"
          data-testid="lifecycle-archive-submit"
          @click="archive"
        >
          {{ busy === 'archive' ? '归档中…' : '归档项目' }}
        </button>
      </section>

      <section
        v-if="canRestoreFromArchive(lifecycle.status)"
        class="mon-block"
        data-testid="lifecycle-restore"
      >
        <h2 class="mon-title">从归档恢复</h2>
        <p class="mon-hint">恢复后重新接收新数据；告警规则保持关闭，由管理员手动启用。</p>
        <button
          type="button"
          class="au-button"
          :disabled="busy !== null"
          data-testid="lifecycle-restore-submit"
          @click="restoreFromArchive"
        >
          {{ busy === 'restore' ? '恢复中…' : '从归档恢复' }}
        </button>
      </section>

      <section
        v-if="canMoveToTrash(lifecycle.status)"
        class="mon-block mon-danger-zone"
        data-testid="lifecycle-trash"
      >
        <h2 class="mon-title">移入回收站</h2>
        <p class="mon-hint">
          仅组织管理员/所有者可执行。移入回收站后上报密钥立即失效、私密令牌撤销， 默认 7
          天内可恢复（在组织回收站处理）。请输入项目名称
          <code class="mon-code">{{ authoritativeName }}</code> 确认。
        </p>
        <label class="mon-field">
          项目名称确认
          <input
            type="text"
            v-model="trashNameInput"
            :placeholder="authoritativeName"
            data-testid="lifecycle-trash-name"
          />
        </label>
        <div class="mon-actions-row">
          <button
            type="button"
            class="au-button au-button--danger"
            :disabled="busy !== null || !trashNameMatches(trashNameInput, authoritativeName)"
            data-testid="lifecycle-trash-submit"
            @click="moveToTrash"
          >
            {{ busy === 'trash' ? '移入中…' : '移入回收站' }}
          </button>
        </div>
      </section>
    </template>

    <p v-if="actionError !== null" class="mon-notice mon-notice--error" role="status">
      {{ actionError }}
    </p>
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
  max-width: 60ch;
}
.mon-meta {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-status-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.mon-name {
  font-weight: 600;
  font-size: 15px;
  color: var(--color-text-primary);
}
.mon-dl {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-1) var(--space-3);
}
.mon-dl dt {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-dl dd {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-primary);
}
.mon-danger-zone {
  border: 1px solid var(--color-status-danger);
  border-radius: var(--radius-base);
  padding: var(--space-3);
}
.mon-field {
  display: inline-flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-field input {
  min-height: var(--control-height);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  font: inherit;
}
.mon-code {
  font-family: ui-monospace, monospace;
  background-color: var(--color-surface-muted);
  padding: 0 var(--space-1);
  border-radius: var(--radius-base);
}
.mon-actions-row {
  margin-top: var(--space-2);
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
.au-button--danger {
  border-color: var(--color-status-danger);
  color: var(--color-status-danger);
}
.mon-notice {
  margin: var(--space-2) 0 0;
  color: var(--color-text-secondary);
}
.mon-notice--error {
  color: var(--color-status-danger);
}
</style>
