<script setup lang="ts">
/**
 * C9 Source Map 工作区（`project.source-maps`，PLT-07）。
 *
 * 只消费 DAT-18 真实契约：`sourceMapsListFiles` 列表、
 * `sourceMapsUpload`/`sourceMapsReplace`/`sourceMapsReparse` 命令。同键同摘要
 * 幂等复用；同键不同摘要必须显式确认替换，绝不静默覆盖。下载因无 Download
 * contract 不显示。Source Map 内容只存在于提交瞬间的内存变量，不进 Store/URL。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { invalidateScope } from '../../api/query.js';
import { formatUtc } from '../../monitoring/format.js';
import {
  fetchReleases,
  fetchSourceMapFiles,
  type ReleaseSummary,
  type SourceMapFileSummary,
  type SourceMapFilesSection,
} from '../../monitoring/queries.js';
import { reparseRelease, replaceSourceMap, uploadSourceMap } from '../../monitoring/commands.js';
import { createIdempotencyKey } from '../../api/client.js';
import type { ScopeKey } from '../../api/scope.js';
import { useSessionStore } from '../../stores/session.js';
import {
  buildSourceMapsView,
  reparseStateLabel,
  sourceMapStatusLabel,
} from './source-maps-view-model.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppTechnicalDetails from '../../components/aurora/AppTechnicalDetails.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';

const route = useRoute();
const session = useSessionStore();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const releaseId = String(route.params.releaseId ?? '');
const scope = { organizationId, projectId };
const projectScopeKey: ScopeKey = { type: 'project', id: projectId };

const files = ref<SourceMapFilesSection | null>(null);
const releases = ref<readonly ReleaseSummary[]>([]);
const loadingFiles = ref(false);
const errorFiles = ref<string | null>(null);
const loadingReleases = ref(false);
const errorReleases = ref<string | null>(null);

const currentRelease = computed<ReleaseSummary | null>(
  () => releases.value.find((release) => release.releaseId === releaseId) ?? null,
);

async function loadFiles(): Promise<void> {
  loadingFiles.value = true;
  errorFiles.value = null;
  try {
    files.value = await fetchSourceMapFiles(scope, releaseId);
  } catch (caught) {
    errorFiles.value = describeRequestError(caught);
  } finally {
    loadingFiles.value = false;
  }
}

async function loadReleases(): Promise<void> {
  loadingReleases.value = true;
  errorReleases.value = null;
  try {
    const data = await fetchReleases(scope);
    if (data.status === 'available') {
      releases.value = data.data.items;
    }
  } catch (caught) {
    errorReleases.value = describeRequestError(caught);
  } finally {
    loadingReleases.value = false;
  }
}

onMounted(() => {
  void loadFiles();
  void loadReleases();
});

// --- upload phase -------------------------------------------------------------------------

const uploadBuildPath = ref('');
const uploadBuildId = ref('');
const uploadFileContent = ref('');
const uploadPhase = ref<
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'duplicate'; message: string }
  | { kind: 'succeeded'; sourceMapFileId: string }
  | { kind: 'error'; message: string }
>({ kind: 'idle' });

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file === undefined) return;
  try {
    uploadFileContent.value = await file.text();
  } catch {
    uploadFileContent.value = '';
  }
}

async function sha256Hex(content: string): Promise<string> {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject !== undefined && typeof cryptoObject.subtle?.digest === 'function') {
    const digest = await cryptoObject.subtle.digest('SHA-256', new TextEncoder().encode(content));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return '0'.repeat(64);
}

async function submitUpload(): Promise<void> {
  const buildPath = uploadBuildPath.value.trim();
  const content = uploadFileContent.value;
  const releaseVersion = currentRelease.value?.version;
  if (releaseVersion === undefined) {
    uploadPhase.value = { kind: 'error', message: '无法确认当前发布版本，无法上传。' };
    return;
  }
  if (buildPath === '' || content === '') {
    uploadPhase.value = { kind: 'error', message: '请填写构建文件路径并选择 Source Map 文件。' };
    return;
  }
  if (content.length > 240000) {
    uploadPhase.value = { kind: 'error', message: 'Source Map 文件过大（上限 240,000 字符）。' };
    return;
  }
  uploadPhase.value = { kind: 'submitting' };
  try {
    const digest = await sha256Hex(content);
    const result = await uploadSourceMap(
      scope,
      {
        releaseVersion,
        buildPath,
        content,
        digest,
        ...(uploadBuildId.value.trim() === '' ? {} : { buildId: uploadBuildId.value.trim() }),
      },
      { csrf: session.csrf ?? '', idempotencyKey: createIdempotencyKey() },
    );
    if (result.status === 'duplicate') {
      uploadPhase.value = {
        kind: 'duplicate',
        message: '同路径同摘要已存在，未重复上传或触发重解析。',
      };
    } else if (result.status === 'replace_conflict') {
      uploadPhase.value = {
        kind: 'error',
        message: '同路径但内容不同，需要显式确认替换。',
      };
      if (result.sourceMapFileId !== undefined && result.version !== undefined) {
        replacePhase.value = {
          kind: 'confirm',
          sourceMapFileId: result.sourceMapFileId,
          version: result.version,
        };
      }
    } else if (result.status === 'uploaded' && result.sourceMapFileId !== undefined) {
      uploadPhase.value = { kind: 'succeeded', sourceMapFileId: result.sourceMapFileId };
      invalidateScope(projectScopeKey);
      void loadFiles();
    } else {
      uploadPhase.value = { kind: 'error', message: '上传结果无法确认。' };
    }
  } catch (caught) {
    uploadPhase.value = { kind: 'error', message: describeRequestError(caught) };
  }
}

// --- replace phase ------------------------------------------------------------------------

const replacePhase = ref<
  | { kind: 'idle' }
  | { kind: 'confirm'; sourceMapFileId: string; version: number }
  | { kind: 'submitting' }
  | { kind: 'succeeded'; sourceMapFileId: string; version: number }
  | { kind: 'error'; message: string }
>({ kind: 'idle' });

async function confirmReplace(): Promise<void> {
  if (replacePhase.value.kind !== 'confirm') return;
  const { sourceMapFileId, version } = replacePhase.value;
  const releaseVersion = currentRelease.value?.version;
  const content = uploadFileContent.value;
  if (releaseVersion === undefined || content === '') {
    replacePhase.value = { kind: 'error', message: '缺少替换所需内容。' };
    return;
  }
  replacePhase.value = { kind: 'submitting' };
  try {
    const digest = await sha256Hex(content);
    const result = await replaceSourceMap(
      scope,
      releaseId,
      sourceMapFileId,
      { content, digest, version },
      { csrf: session.csrf ?? '', idempotencyKey: createIdempotencyKey() },
    );
    if (result.status === 'replaced') {
      replacePhase.value = { kind: 'succeeded', sourceMapFileId, version: result.version };
      uploadPhase.value = { kind: 'idle' };
      invalidateScope(projectScopeKey);
      void loadFiles();
    } else {
      replacePhase.value = { kind: 'error', message: '替换结果无法确认。' };
    }
  } catch (caught) {
    replacePhase.value = { kind: 'error', message: describeRequestError(caught) };
  }
}

function cancelReplace(): void {
  replacePhase.value = { kind: 'idle' };
  uploadPhase.value = { kind: 'idle' };
}

const replaceSubmitting = computed(() => replacePhase.value.kind === 'submitting');
const replaceError = computed<string | null>(() =>
  replacePhase.value.kind === 'error' ? replacePhase.value.message : null,
);
const uploadSubmitting = computed(() => uploadPhase.value.kind === 'submitting');
const uploadDuplicateMessage = computed<string | null>(() =>
  uploadPhase.value.kind === 'duplicate' ? uploadPhase.value.message : null,
);
const uploadSuccessMessage = computed<string | null>(() =>
  uploadPhase.value.kind === 'succeeded' ? '上传成功，已触发有限重解析。' : null,
);
const uploadErrorMessage = computed<string | null>(() =>
  uploadPhase.value.kind === 'error' ? uploadPhase.value.message : null,
);
const reparseSubmitting = computed(() => reparsePhase.value.kind === 'submitting');
const reparseSuccessCount = computed<number | null>(() =>
  reparsePhase.value.kind === 'succeeded' ? reparsePhase.value.taskCount : null,
);
const reparseErrorMessage = computed<string | null>(() =>
  reparsePhase.value.kind === 'error' ? reparsePhase.value.message : null,
);

// --- reparse phase -------------------------------------------------------------------------

const reparsePhase = ref<
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'succeeded'; taskCount: number }
  | { kind: 'error'; message: string }
>({ kind: 'idle' });

async function submitReparse(): Promise<void> {
  reparsePhase.value = { kind: 'submitting' };
  try {
    const result = await reparseRelease(scope, releaseId, {
      csrf: session.csrf ?? '',
      idempotencyKey: createIdempotencyKey(),
    });
    if (result.status === 'queued') {
      reparsePhase.value = { kind: 'succeeded', taskCount: result.taskCount };
      invalidateScope(projectScopeKey);
      void loadFiles();
    } else {
      reparsePhase.value = { kind: 'error', message: '重解析排队结果无法确认。' };
    }
  } catch (caught) {
    reparsePhase.value = { kind: 'error', message: describeRequestError(caught) };
  }
}

const state = computed(() =>
  buildSourceMapsView({
    loading: loadingFiles.value,
    error: errorFiles.value,
    files: files.value ?? null,
    upload: uploadPhase.value,
    replace: replacePhase.value,
    reparse: reparsePhase.value,
  }),
);

const selectedSourceMapFileId = ref<string | null>(null);
const selectedSourceMapFile = computed<SourceMapFileSummary | null>(() => {
  if (state.value.files.kind !== 'available') return null;
  return (
    state.value.files.data.find((file) => file.sourceMapFileId === selectedSourceMapFileId.value) ??
    null
  );
});

function selectSourceMapFile(sourceMapFileId: string): void {
  selectedSourceMapFileId.value = sourceMapFileId;
}

const releaseVersionText = computed<string>(() => {
  if (loadingReleases.value) return '正在加载发布…';
  if (errorReleases.value !== null) return '发布信息暂不可用';
  return currentRelease.value?.version ?? '发布版本暂不可用';
});
</script>

<template>
  <section class="au-surface" data-testid="project-source-maps-view">
    <AppPageHeader title="Source Map" />

    <section class="mon-block" data-testid="source-map-release-context">
      <h2 class="mon-title">发布上下文</h2>
      <p class="mon-meta">发布版本：{{ releaseVersionText }}</p>
      <AppTechnicalDetails summary="发布技术详情">releaseId: {{ releaseId }}</AppTechnicalDetails>
    </section>

    <div class="delivery-workspace">
      <section class="mon-block delivery-list" data-testid="delivery-list">
        <div data-testid="source-map-files">
          <h2 class="mon-title">当前有效文件</h2>
          <template v-if="state.files.kind === 'loading'">
            <p class="mon-hint" role="status">正在加载文件列表…</p>
          </template>
          <template v-else-if="state.files.kind !== 'available'">
            <SectionNotice :view="state.files" />
          </template>
          <template v-else>
            <ul v-if="state.files.data.length > 0" class="mon-file-list">
              <li
                v-for="file in state.files.data"
                :key="file.sourceMapFileId"
                class="mon-file-item"
              >
                <button
                  type="button"
                  class="mon-file-select"
                  :class="{ 'is-selected': selectedSourceMapFileId === file.sourceMapFileId }"
                  :aria-pressed="selectedSourceMapFileId === file.sourceMapFileId"
                  :data-testid="`source-map-file-${file.sourceMapFileId}`"
                  @click="selectSourceMapFile(file.sourceMapFileId)"
                  @keydown.enter.prevent="selectSourceMapFile(file.sourceMapFileId)"
                  @keydown.space.prevent="selectSourceMapFile(file.sourceMapFileId)"
                >
                  <span class="mon-file-row">
                    <span class="mon-build-path">{{ file.buildPath }}</span>
                    <span class="mon-badge">{{ sourceMapStatusLabel(file.status) }}</span>
                  </span>
                  <span class="mon-meta">
                    摘要 {{ file.digestPrefix }}… · 上传 {{ formatUtc(file.uploadedAt) }}
                    <template v-if="file.replacedAt !== undefined">
                      · 替换 {{ formatUtc(file.replacedAt) }}</template
                    >
                  </span>
                  <span class="mon-meta">
                    重解析：{{ reparseStateLabel(file.reparse.state) }}
                    <template v-if="file.reparse.totalCount !== undefined">
                      · {{ file.reparse.processedCount ?? 0 }}/{{ file.reparse.totalCount }}
                    </template>
                    <template v-if="file.reparse.updatedAt !== undefined">
                      · 更新 {{ formatUtc(file.reparse.updatedAt) }}
                    </template>
                  </span>
                </button>
              </li>
            </ul>
            <p v-else class="mon-hint">
              该发布尚无有效 Source Map 文件。仅项目管理员或获准开发成员可上传。
            </p>
          </template>
        </div>
      </section>

      <section class="mon-block delivery-detail" data-testid="delivery-detail">
        <section class="mon-selected-file" data-testid="source-map-selected-file">
          <h2 class="mon-title">已选文件</h2>
          <p v-if="selectedSourceMapFile === null" class="mon-hint">
            从左侧列表选择文件以查看已有投影中的证据。
          </p>
          <template v-else>
            <p class="mon-build-path">{{ selectedSourceMapFile.buildPath }}</p>
            <dl class="mon-dl">
              <dt>文件状态</dt>
              <dd>{{ sourceMapStatusLabel(selectedSourceMapFile.status) }}</dd>
              <dt>摘要前缀</dt>
              <dd>{{ selectedSourceMapFile.digestPrefix }}…</dd>
              <dt>上传时间</dt>
              <dd>{{ formatUtc(selectedSourceMapFile.uploadedAt) }}</dd>
              <template v-if="selectedSourceMapFile.replacedAt !== undefined">
                <dt>替换时间</dt>
                <dd>{{ formatUtc(selectedSourceMapFile.replacedAt) }}</dd>
              </template>
              <dt>重解析</dt>
              <dd>{{ reparseStateLabel(selectedSourceMapFile.reparse.state) }}</dd>
            </dl>
            <AppTechnicalDetails
              summary="文件技术详情"
              data-testid="source-map-selected-file-technical"
            >
              sourceMapFileId: {{ selectedSourceMapFile.sourceMapFileId }} version:
              {{ selectedSourceMapFile.version }}
            </AppTechnicalDetails>
          </template>
        </section>
        <div data-testid="source-map-file-actions">
          <section data-testid="source-map-upload">
            <h2 class="mon-title">上传 Source Map</h2>
            <template v-if="replacePhase.kind === 'confirm'">
              <div class="mon-confirm" role="alert" data-testid="source-map-replace-confirm">
                <p>
                  同一构建路径已存在不同内容的 Source
                  Map。显式确认替换将覆盖当前文件并重新解析，替换进入审计。
                </p>
                <div class="mon-actions-row">
                  <button
                    type="button"
                    class="au-button au-button--danger"
                    data-testid="source-map-confirm-replace"
                    :disabled="replaceSubmitting"
                    @click="confirmReplace"
                  >
                    确认替换
                  </button>
                  <button
                    type="button"
                    class="au-button"
                    data-testid="source-map-cancel-replace"
                    @click="cancelReplace"
                  >
                    取消
                  </button>
                </div>
                <p v-if="replaceError !== null" class="mon-notice mon-notice--error" role="status">
                  {{ replaceError }}
                </p>
              </div>
            </template>
            <template v-else>
              <div class="mon-upload-form">
                <label class="mon-field">
                  构建文件路径
                  <input
                    type="text"
                    v-model="uploadBuildPath"
                    data-testid="source-map-build-path"
                    placeholder="/assets/app.js"
                  />
                </label>
                <label class="mon-field">
                  Source Map 文件（≤240,000 字符）
                  <input
                    type="file"
                    accept=".map,application/json"
                    data-testid="source-map-file-input"
                    @change="onFileSelected"
                  />
                </label>
                <label class="mon-field">
                  构建标识（可选）
                  <input
                    type="text"
                    v-model="uploadBuildId"
                    data-testid="source-map-build-id"
                    placeholder="build-123"
                  />
                </label>
                <div class="mon-actions-row">
                  <button
                    type="button"
                    class="au-button"
                    data-testid="source-map-upload-submit"
                    :disabled="uploadSubmitting"
                    @click="submitUpload"
                  >
                    {{ uploadSubmitting ? '上传中…' : '上传' }}
                  </button>
                </div>
              </div>
              <p
                v-if="uploadDuplicateMessage !== null"
                class="mon-notice"
                role="status"
                data-testid="source-map-duplicate-note"
              >
                {{ uploadDuplicateMessage }}
              </p>
              <p
                v-if="uploadSuccessMessage !== null"
                class="mon-notice"
                role="status"
                data-testid="source-map-upload-ok"
              >
                {{ uploadSuccessMessage }}
              </p>
              <p
                v-if="uploadErrorMessage !== null"
                class="mon-notice mon-notice--error"
                role="status"
              >
                {{ uploadErrorMessage }}
              </p>
            </template>
          </section>

          <section data-testid="source-map-reparse">
            <h2 class="mon-title">重新解析</h2>
            <div class="mon-actions-row">
              <button
                type="button"
                class="au-button"
                data-testid="source-map-reparse-submit"
                :disabled="reparseSubmitting"
                @click="submitReparse"
              >
                {{ reparseSubmitting ? '排队中…' : '重新解析当前发布' }}
              </button>
            </div>
            <p
              v-if="reparseSuccessCount !== null"
              class="mon-notice"
              role="status"
              data-testid="source-map-reparse-ok"
            >
              已排队 {{ reparseSuccessCount }} 个文件。
            </p>
            <p
              v-if="reparseErrorMessage !== null"
              class="mon-notice mon-notice--error"
              role="status"
            >
              {{ reparseErrorMessage }}
            </p>
          </section>
        </div>
      </section>
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
.mon-file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.mon-file-item {
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
}
.mon-file-select {
  width: 100%;
  padding: var(--space-3);
  border: 0;
  border-radius: inherit;
  background: var(--color-surface-bg);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.mon-file-select:hover,
.mon-file-select:focus-visible,
.mon-file-select.is-selected {
  background: var(--color-surface-raised);
}
.mon-file-select:focus-visible {
  outline: 2px solid var(--color-action-primary);
  outline-offset: 2px;
}
.mon-file-select.is-selected {
  box-shadow: inset 3px 0 0 var(--color-action-primary);
}
.mon-file-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.mon-build-path {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text-primary);
}
.mon-badge {
  display: inline-block;
  padding: 1px var(--space-2);
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-upload-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 52ch;
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
  border-radius: var(--radius-control);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  font: inherit;
}
.mon-actions-row {
  margin-top: var(--space-3);
  display: flex;
  gap: var(--space-2);
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
.au-button--danger {
  border-color: var(--color-status-danger);
  color: var(--color-status-danger);
}
.mon-confirm {
  border: 1px solid var(--color-status-warning);
  border-radius: var(--radius-control);
  padding: var(--space-3);
  max-width: 56ch;
}
.mon-notice {
  margin: var(--space-2) 0 0;
  color: var(--color-text-secondary);
}
.mon-notice--error {
  color: var(--color-status-danger);
}
.mon-file-select .mon-meta {
  display: block;
  margin-top: var(--space-1);
}
.delivery-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
  align-items: start;
  gap: var(--space-4);
}
.delivery-list,
.delivery-detail {
  min-width: 0;
}
.delivery-detail {
  border-left: 1px solid var(--color-border-default);
  padding-left: var(--space-4);
}
.mon-selected-file {
  margin-bottom: var(--space-5);
}
.mon-dl {
  margin: var(--space-3) 0 0;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-1) var(--space-3);
}
.mon-dl dt {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-dl dd {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 14px;
}
@media (max-width: 800px) {
  .delivery-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .delivery-detail {
    border-left: 0;
    border-top: 1px solid var(--color-border-default);
    padding: var(--space-4) 0 0;
  }
}
</style>
