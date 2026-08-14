<script setup lang="ts">
/**
 * C14 客户端上报密钥（`project.client-keys`，PLT-08）。
 *
 * 只消费 `credentialsListClientKeys`（C14）metadata 与 create/disable/enable/
 * revoke 命令。创建成功返回的一次性 `clientKey` 只存在当前组件内存，显示
 * "现在保存，关闭后无法再次查看"，复制后/离开即清空；不进 Store/URL/日志。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { ApiError } from '../../api/errors.js';
import { invalidateScope } from '../../api/query.js';
import { createIdempotencyKey } from '../../api/client.js';
import {
  fetchClientKeys,
  type ClientKeyMetadata,
  type ClientKeysData,
} from '../../monitoring/queries.js';
import {
  createClientKey,
  disableClientKey,
  enableClientKey,
  revokeClientKey,
} from '../../monitoring/commands.js';
import { useSessionStore } from '../../stores/session.js';
import {
  buildClientKeysView,
  clientKeyStatusLabel,
  isRevoked,
  type CreateKeyPhase,
} from './client-keys-view-model.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';

const route = useRoute();
const session = useSessionStore();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const scope = { organizationId, projectId };

const data = ref<ClientKeysData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const originsInput = ref('');
const environmentsInput = ref('');
const allowNonBrowser = ref(false);
const createPhase = ref<CreateKeyPhase>({ kind: 'idle' });
const actionBusy = ref<string | null>(null);
const actionError = ref<string | null>(null);
const copyState = ref<'idle' | 'copied'>('idle');
const selectedKeyId = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    data.value = await fetchClientKeys(scope);
    if (selectedKeyId.value === null && data.value.keys.status === 'available') {
      selectedKeyId.value = data.value.keys.data.items[0]?.keyId ?? null;
    }
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
  buildClientKeysView({
    loading: loading.value,
    error: error.value,
    keys: data.value?.keys ?? null,
    create: createPhase.value,
  }),
);

const selectedKey = computed(() => {
  if (state.value.keys.kind !== 'available') return null;
  return (
    state.value.keys.data.find((key) => key.keyId === selectedKeyId.value) ??
    state.value.keys.data[0] ??
    null
  );
});

function describeCommandError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.code === 'authorization') return '你没有管理该项目密钥的权限。';
    if (caught.code === 'state_machine_conflict') return '该密钥当前状态不允许此操作。';
  }
  return describeRequestError(caught);
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

async function submitCreate(): Promise<void> {
  createPhase.value = { kind: 'submitting' };
  try {
    const result = await createClientKey(
      scope,
      {
        origins: splitList(originsInput.value),
        environments: splitList(environmentsInput.value),
        allowNonBrowser: allowNonBrowser.value,
      },
      { csrf: session.csrf ?? '', idempotencyKey: createIdempotencyKey() },
    );
    createPhase.value = { kind: 'revealed', clientKey: result.clientKey, keyId: result.keyId };
    originsInput.value = '';
    environmentsInput.value = '';
    allowNonBrowser.value = false;
    invalidateScope({ type: 'project', id: projectId });
    void load();
  } catch (caught) {
    createPhase.value = { kind: 'error', message: describeCommandError(caught) };
  }
}

function acknowledgeSecret(): void {
  createPhase.value = { kind: 'idle' };
  copyState.value = 'idle';
}

async function copySecret(): Promise<void> {
  if (createPhase.value.kind !== 'revealed') return;
  try {
    await navigator.clipboard.writeText(createPhase.value.clientKey);
    copyState.value = 'copied';
  } catch {
    copyState.value = 'idle';
  }
}

async function runAction(keyId: string, task: () => Promise<unknown>): Promise<void> {
  if (actionBusy.value !== null) return;
  actionBusy.value = keyId;
  actionError.value = null;
  try {
    await task();
    invalidateScope({ type: 'project', id: projectId });
    await load();
  } catch (caught) {
    actionError.value = describeCommandError(caught);
  } finally {
    actionBusy.value = null;
  }
}

function disable(key: ClientKeyMetadata): void {
  void runAction(key.keyId, () =>
    disableClientKey(scope, key.keyId, {
      csrf: session.csrf ?? '',
      idempotencyKey: createIdempotencyKey(),
    }),
  );
}

function enable(key: ClientKeyMetadata): void {
  void runAction(key.keyId, () =>
    enableClientKey(scope, key.keyId, {
      csrf: session.csrf ?? '',
      idempotencyKey: createIdempotencyKey(),
    }),
  );
}

function revoke(key: ClientKeyMetadata): void {
  if (!window.confirm('撤销后该密钥永久失效且不可恢复。确定撤销？')) return;
  void runAction(key.keyId, () =>
    revokeClientKey(scope, key.keyId, {
      csrf: session.csrf ?? '',
      idempotencyKey: createIdempotencyKey(),
    }),
  );
}

function keyTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success';
  if (status === 'disabled') return 'warning';
  if (status === 'revoked') return 'danger';
  return 'neutral';
}
</script>

<template>
  <section class="au-surface" data-testid="project-client-keys-view">
    <AppPageHeader title="客户端密钥" />

    <section class="mon-block" data-testid="client-key-create">
      <h2 class="mon-title">创建上报密钥</h2>
      <template v-if="createPhase.kind === 'revealed'">
        <div class="mon-secret" role="status" data-testid="client-key-secret-delivery">
          <p class="mon-secret-title">密钥已创建 — 现在保存，关闭后无法再次查看。</p>
          <code class="mon-secret-value" data-testid="client-key-secret-value">{{
            createPhase.clientKey
          }}</code>
          <div class="mon-actions-row">
            <button
              type="button"
              class="au-button"
              data-testid="client-key-copy"
              @click="copySecret"
            >
              {{ copyState === 'copied' ? '已复制' : '复制密钥' }}
            </button>
            <button
              type="button"
              class="au-button"
              data-testid="client-key-ack"
              @click="acknowledgeSecret"
            >
              我已保存
            </button>
          </div>
          <p class="mon-meta">密钥只显示这一次；丢失后只能撤销并重建。</p>
        </div>
      </template>
      <template v-else>
        <div class="mon-create-form">
          <label class="mon-field">
            允许来源（逗号分隔）
            <input
              type="text"
              v-model="originsInput"
              placeholder="https://app.example.com"
              data-testid="client-key-origins"
            />
          </label>
          <label class="mon-field">
            允许运行环境（逗号分隔）
            <input
              type="text"
              v-model="environmentsInput"
              placeholder="production"
              data-testid="client-key-environments"
            />
          </label>
          <label class="mon-check">
            <input type="checkbox" v-model="allowNonBrowser" data-testid="client-key-non-browser" />
            允许非浏览器环境
          </label>
          <button
            type="button"
            class="au-button"
            data-testid="client-key-create-submit"
            :disabled="createPhase.kind === 'submitting'"
            @click="submitCreate"
          >
            {{ createPhase.kind === 'submitting' ? '创建中…' : '创建密钥' }}
          </button>
        </div>
        <p v-if="createPhase.kind === 'error'" class="mon-notice mon-notice--error" role="status">
          {{ createPhase.kind === 'error' ? createPhase.message : '' }}
        </p>
      </template>
    </section>

    <section class="mon-block" data-testid="client-key-list">
      <h2 class="mon-title">密钥列表</h2>
      <template v-if="state.keys.kind === 'loading'">
        <p class="mon-hint" role="status">正在加载密钥…</p>
      </template>
      <template v-else-if="state.keys.kind !== 'available'">
        <SectionNotice :view="state.keys" />
      </template>
      <template v-else>
        <div v-if="state.keys.data.length > 0" class="key-workspace">
          <div class="key-list-surface">
            <table class="governance-table" data-testid="client-key-list-table">
              <thead>
                <tr>
                  <th>密钥标识</th>
                  <th>状态</th>
                  <th><span class="sr-only">选择密钥</span></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="key in state.keys.data"
                  :key="key.credentialId"
                  :class="{ 'is-selected': selectedKey?.keyId === key.keyId }"
                >
                  <td class="mon-key-id">{{ key.keyId }}</td>
                  <td>
                    <AppStatusBadge :tone="keyTone(key.status)">
                      {{ clientKeyStatusLabel(key.status) }}
                    </AppStatusBadge>
                  </td>
                  <td>
                    <button
                      type="button"
                      class="au-button au-button--compact"
                      :aria-pressed="selectedKey?.keyId === key.keyId"
                      @click="selectedKeyId = key.keyId"
                    >
                      查看
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <aside v-if="selectedKey !== null" class="key-detail" data-testid="client-key-detail">
            <p class="key-detail-label">所选密钥</p>
            <code class="mon-key-id">{{ selectedKey.keyId }}</code>
            <dl class="key-detail-evidence">
              <dt>来源</dt>
              <dd>{{ selectedKey.origins.length > 0 ? selectedKey.origins.join(', ') : '（未限定）' }}</dd>
              <dt>环境</dt>
              <dd>{{ selectedKey.environments.length > 0 ? selectedKey.environments.join(', ') : '（未限定）' }}</dd>
              <dt>接入方式</dt>
              <dd>{{ selectedKey.allowNonBrowser ? '允许非浏览器' : '仅浏览器' }}</dd>
              <template v-if="selectedKey.expiresAt !== undefined">
                <dt>过期</dt>
                <dd>{{ selectedKey.expiresAt }}</dd>
              </template>
            </dl>
            <div class="mon-actions-row">
              <button
                v-if="selectedKey.status === 'active'"
                type="button"
                class="au-button"
                :disabled="actionBusy !== null"
                :data-testid="`disable-key-${selectedKey.keyId}`"
                @click="disable(selectedKey)"
              >
                停用
              </button>
              <button
                v-if="selectedKey.status === 'disabled'"
                type="button"
                class="au-button"
                :disabled="actionBusy !== null"
                :data-testid="`enable-key-${selectedKey.keyId}`"
                @click="enable(selectedKey)"
              >
                重新启用
              </button>
              <button
                v-if="!isRevoked(selectedKey)"
                type="button"
                class="au-button au-button--danger"
                :disabled="actionBusy !== null"
                :data-testid="`revoke-key-${selectedKey.keyId}`"
                @click="revoke(selectedKey)"
              >
                撤销
              </button>
              <span v-if="isRevoked(selectedKey)" class="mon-meta">已撤销，不可恢复</span>
            </div>
          </aside>
        </div>
        <p v-else class="mon-hint">项目尚无客户端上报密钥。</p>
      </template>
      <p v-if="actionError !== null" class="mon-notice mon-notice--error" role="status">
        {{ actionError }}
      </p>
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
.mon-create-form {
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
.mon-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 13px;
  color: var(--color-text-primary);
}
.mon-secret {
  border: 1px solid var(--color-status-warning);
  border-radius: var(--radius-control);
  padding: var(--space-3);
  max-width: 64ch;
}
.mon-secret-title {
  margin: 0 0 var(--space-2);
  font-weight: 600;
}
.mon-secret-value {
  display: block;
  padding: var(--space-2);
  border-radius: var(--radius-control);
  background-color: var(--color-surface-muted);
  color: var(--color-text-primary);
  word-break: break-all;
  font-size: 13px;
}
.key-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(240px, 0.8fr);
  gap: var(--space-4);
  align-items: start;
}
.key-list-surface,
.key-detail {
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-surface);
  background-color: var(--color-surface-bg);
}
.key-list-surface {
  overflow-x: auto;
}
.governance-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 380px;
}
.governance-table th,
.governance-table td {
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border-default);
  text-align: left;
  vertical-align: middle;
}
.governance-table th {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.governance-table tbody tr:last-child td {
  border-bottom: 0;
}
.governance-table tr.is-selected {
  background-color: var(--color-context-bg);
}
.key-detail {
  padding: var(--space-3);
}
.key-detail-label {
  margin: 0 0 var(--space-1);
  color: var(--color-text-secondary);
  font-size: 12px;
}
.key-detail-evidence {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-1) var(--space-3);
  margin: var(--space-3) 0 0;
}
.key-detail-evidence dt {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.key-detail-evidence dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.mon-key-id {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text-primary);
}
.mon-actions-row {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
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
.au-button--compact {
  min-height: var(--compact-control-height);
  padding: 0 var(--space-2);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 760px) {
  .key-workspace {
    grid-template-columns: 1fr;
  }
}
.mon-notice {
  margin: var(--space-2) 0 0;
  color: var(--color-text-secondary);
}
.mon-notice--error {
  color: var(--color-status-danger);
}
</style>
