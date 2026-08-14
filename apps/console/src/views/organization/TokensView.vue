<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  OPERATION_ID_CREATE_PRIVATE_TOKEN,
  OPERATION_ID_LIST_MEMBERS,
  OPERATION_ID_LIST_PRIVATE_TOKENS,
  OPERATION_ID_REVOKE_PRIVATE_TOKEN,
} from '@aurora/platform-contract';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { executeQuery, invalidateScope } from '../../api/query.js';
import { ApiError } from '../../api/errors.js';
import { describeRequestError } from '../../api/feedback.js';
import { useSessionStore } from '../../stores/session.js';
import AppButton from '../../components/aurora/AppButton.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppSection from '../../components/aurora/AppSection.vue';
import AppSkeleton from '../../components/aurora/AppSkeleton.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';

type OrgRole = 'owner' | 'admin' | 'member';

// B6 fixed public scope allowlist (spec §7): a token may only request scopes
// from this frozen set.
const TOKEN_SCOPES = ['source_maps.upload', 'releases.write'] as const;
type TokenScope = (typeof TOKEN_SCOPES)[number];

interface TokenSummary {
  readonly tokenId: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: string;
  readonly revokedAt?: string;
  readonly lastUsedAt?: string;
}

interface MemberSummary {
  readonly accountId: string;
  readonly orgRole: OrgRole;
}

interface CreateTokenResult {
  readonly tokenId: string;
  readonly tokenPlaintext: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: string;
}

const route = useRoute();
const session = useSessionStore();

const organizationId = computed(() => {
  const raw = route.params.organizationId;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
});

// ---- UX-only owner/admin gate (the server re-checks authoritatively). ----
const gateLoading = ref(true);
const gateError = ref<string | null>(null);
const canManage = ref(false);

// ---- token list (metadata only) ----
const tokens = ref<readonly TokenSummary[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);

// ---- create-token form ----
const tokenName = ref('');
const selectedScopes = ref<readonly TokenScope[]>([]);
const expiresAt = ref('');
const creating = ref(false);
const createError = ref<string | null>(null);

// ---- ONE-TIME SECRET: held ONLY in this component's memory. The create
// response carries `tokenPlaintext` exactly once; it is never persisted
// client-side (no store, no storage, no URL), and is cleared when the panel is
// acknowledged or the component unmounts (route leave / refresh). ----
const createResult = ref<CreateTokenResult | null>(null);
const copyState = ref<'idle' | 'copied'>('idle');
const revokeBusy = ref<string | null>(null);

const myAccountId = computed(() => session.account?.accountId ?? null);

const tokenNameError = computed<string | null>(() => {
  const name = tokenName.value.trim();
  if (name.length < 1 || name.length > 128) return '令牌名称需为 1–128 个字符。';
  return null;
});

const scopeError = computed<string | null>(() => {
  if (selectedScopes.value.length === 0) return '至少选择一个授权范围。';
  return null;
});

const expiresAtError = computed<string | null>(() => {
  const value = expiresAt.value.trim();
  if (value.length === 0) return null;
  if (Number.isNaN(new Date(value).getTime())) return '过期时间格式不正确。';
  return null;
});

watch(
  organizationId,
  () => {
    void loadGate();
  },
  { immediate: true },
);

function describeLoadError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.code === 'authorization') return '你没有权限查看该组织的令牌。';
    if (caught.code === 'not_found') return '组织不存在或你没有访问权限。';
  }
  return describeRequestError(caught);
}

function describeCommandError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'authorization':
        return '你没有权限执行该操作。';
      case 'not_found':
        return '令牌不存在或不属于该组织。';
      case 'field_validation':
        return '令牌授权范围不在允许集合内。';
      case 'business_validation':
      case 'idempotency_conflict':
        return '令牌创建未能完成，请重试。';
      default:
        return describeRequestError(caught);
    }
  }
  return describeRequestError(caught);
}

async function loadGate(): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null) {
    gateLoading.value = false;
    return;
  }
  gateLoading.value = true;
  gateError.value = null;
  try {
    const data = await executeQuery<{ members: readonly MemberSummary[] }>({
      operationId: OPERATION_ID_LIST_MEMBERS,
      input: { pathParams: { organizationId: orgId } },
      scope: { type: 'organization', id: orgId },
    });
    const mine = data.members.find((member) => member.accountId === myAccountId.value);
    canManage.value = mine?.orgRole === 'owner' || mine?.orgRole === 'admin';
    if (canManage.value) void loadTokens();
  } catch (caught) {
    canManage.value = false;
    gateError.value = describeLoadError(caught);
  } finally {
    gateLoading.value = false;
  }
}

async function loadTokens(): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null) return;
  loading.value = true;
  loadError.value = null;
  try {
    const data = await executeQuery<{ tokens: readonly TokenSummary[] }>({
      operationId: OPERATION_ID_LIST_PRIVATE_TOKENS,
      input: { pathParams: { organizationId: orgId } },
      scope: { type: 'organization', id: orgId },
    });
    tokens.value = data.tokens;
  } catch (caught) {
    tokens.value = [];
    loadError.value = describeLoadError(caught);
  } finally {
    loading.value = false;
  }
}

async function refreshTokens(): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null) return;
  invalidateScope({ type: 'organization', id: orgId });
  await loadTokens();
}

function toggleScope(scope: TokenScope): void {
  selectedScopes.value = selectedScopes.value.includes(scope)
    ? selectedScopes.value.filter((candidate) => candidate !== scope)
    : [...selectedScopes.value, scope];
}

async function onCreateToken(): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null || creating.value || session.csrf === null) return;
  if (tokenNameError.value !== null || scopeError.value !== null || expiresAtError.value !== null) {
    return;
  }
  creating.value = true;
  createError.value = null;
  try {
    const body: Record<string, unknown> = {
      name: tokenName.value.trim(),
      scopes: [...selectedScopes.value],
      idempotencyKey: createIdempotencyKey(),
    };
    const expiry = expiresAt.value.trim();
    if (expiry.length > 0) body.expiresAt = new Date(expiry).toISOString();
    const data = await platformRequest<CreateTokenResult>(
      OPERATION_ID_CREATE_PRIVATE_TOKEN,
      { pathParams: { organizationId: orgId }, body },
      { scope: { type: 'organization', id: orgId }, csrf: session.csrf },
    );
    // The plaintext exists only here, in memory, until the panel is closed or the
    // route is left. It is never persisted client-side.
    createResult.value = data;
    copyState.value = 'idle';
    tokenName.value = '';
    selectedScopes.value = [];
    expiresAt.value = '';
    void refreshTokens();
  } catch (caught) {
    createError.value = describeCommandError(caught);
  } finally {
    creating.value = false;
  }
}

async function onRevokeToken(token: TokenSummary): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null || session.csrf === null || revokeBusy.value !== null) return;
  revokeBusy.value = token.tokenId;
  try {
    await platformRequest(
      OPERATION_ID_REVOKE_PRIVATE_TOKEN,
      { pathParams: { organizationId: orgId, tokenId: token.tokenId } },
      { scope: { type: 'organization', id: orgId }, csrf: session.csrf },
    );
    tokens.value = tokens.value.map((candidate) =>
      candidate.tokenId === token.tokenId
        ? { ...candidate, revokedAt: new Date().toISOString() }
        : candidate,
    );
    // The org-scope request cache must not serve the stale pre-revoke list on a
    // later remount: a fresh mount re-reads the server and sees the revoked row.
    invalidateScope({ type: 'organization', id: orgId });
  } catch (caught) {
    loadError.value = describeCommandError(caught);
  } finally {
    revokeBusy.value = null;
  }
}

async function onCopyPlaintext(): Promise<void> {
  const plaintext = createResult.value?.tokenPlaintext;
  if (plaintext === undefined) return;
  try {
    await navigator.clipboard.writeText(plaintext);
    copyState.value = 'copied';
  } catch {
    copyState.value = 'idle';
  }
}

function onClosePlaintextPanel(): void {
  // Explicit user acknowledgment clears the one-time secret from memory.
  createResult.value = null;
  copyState.value = 'idle';
}

// Belt-and-suspenders: any route leave / remount clears the in-memory one-time
// secret, so a back-navigation or a page refresh never re-displays it. The
// plaintext never touches the URL, history.state, a store, or storage, so a
// refresh constructs a fresh component with no secret at all.
onBeforeUnmount(() => {
  createResult.value = null;
  copyState.value = 'idle';
});

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
</script>

<template>
  <section class="au-surface" data-testid="tokens-view">
    <AppPageHeader title="私有令牌" description="管理组织私有令牌；明文只在创建后显示一次。" />

    <AppStatusBadge v-if="gateError !== null" tone="danger" data-testid="tokens-gate-error">
      {{ gateError }}
    </AppStatusBadge>

    <p v-else-if="!gateLoading && !canManage" class="au-hint" data-testid="tokens-forbidden">
      你没有权限管理该组织的私有令牌。
    </p>

    <template v-else-if="!gateLoading">
      <AppStatusBadge v-if="loadError !== null" tone="danger" data-testid="tokens-error">
        {{ loadError }}
      </AppStatusBadge>

      <AppSkeleton v-else-if="loading" label="正在加载令牌…" :lines="4" data-testid="tokens-loading" />

      <template v-else>
        <!-- ONE-TIME plaintext panel: exists only while createResult is in memory. -->
        <AppSection
          v-if="createResult !== null"
          title="一次性令牌明文"
          description="请立即保存；关闭、离开页面或刷新后不会再次显示。"
          tone="warning"
          class="au-one-time-secret"
          data-testid="token-plaintext-panel"
        >
          <AppStatusBadge tone="warning">一次性令牌已创建 — 仅显示这一次</AppStatusBadge>
          <p class="au-hint">
            请立即复制并妥善保存。离开此页或刷新后，明文不会再次显示（服务端不保存明文，仅保存摘要）。
          </p>
          <div class="au-secret-row">
            <code class="au-secret-value" data-testid="token-plaintext">{{
              createResult.tokenPlaintext
            }}</code>
            <AppButton variant="secondary" data-testid="token-copy-button" @click="onCopyPlaintext">
              {{ copyState === 'copied' ? '已复制' : '复制' }}
            </AppButton>
            <AppButton
              variant="danger"
              data-testid="token-close-panel"
              @click="onClosePlaintextPanel"
            >
              我已保存，关闭
            </AppButton>
          </div>
          <p class="au-hint">令牌摘要与明文不会出现在令牌列表中。</p>
        </AppSection>

        <AppSection title="令牌列表" description="列表仅保留名称、范围和状态等元数据。">
          <template #actions>
            <div class="au-list-toolbar" role="toolbar" aria-label="令牌列表操作">
              <AppButton variant="secondary" :disabled="loading" @click="void refreshTokens()">刷新令牌</AppButton>
            </div>
          </template>
          <ul v-if="tokens.length > 0" class="au-token-list" data-testid="token-list">
            <li
              v-for="token in tokens"
              :key="token.tokenId"
              class="au-token-item"
              data-testid="token-row"
            >
              <div class="au-token-meta">
                <span class="au-token-name" data-testid="token-name">{{ token.name }}</span>
                <span class="au-token-scopes">{{ token.scopes.join(', ') }}</span>
                <span v-if="token.expiresAt !== undefined" class="au-token-attr">
                  过期 {{ formatDate(token.expiresAt) }}
                </span>
                <span v-if="token.revokedAt !== undefined" class="au-token-attr">
                  已撤销 {{ formatDate(token.revokedAt) }}
                </span>
                <span v-else-if="token.lastUsedAt !== undefined" class="au-token-attr">
                  最近使用 {{ formatDate(token.lastUsedAt) }}
                </span>
              </div>
              <AppButton
                v-if="token.revokedAt === undefined"
                variant="danger"
                :disabled="revokeBusy === token.tokenId"
                :data-testid="`revoke-token-${token.tokenId}`"
                @click="onRevokeToken(token)"
              >
                {{ revokeBusy === token.tokenId ? '撤销中…' : '撤销' }}
              </AppButton>
              <span v-else class="au-token-attr">已撤销</span>
            </li>
          </ul>
          <p v-else class="au-hint">暂无私有令牌。</p>
        </AppSection>

        <AppSection title="创建私有令牌" description="选择最小必要授权范围，并可设置到期时间。" data-testid="token-create">
          <form class="au-form" novalidate @submit.prevent="onCreateToken">
            <div class="au-field">
              <label class="au-field__label" for="token-name">名称</label>
              <input
                id="token-name"
                class="au-field__input"
                type="text"
                :value="tokenName"
                data-testid="token-name-input"
                @input="tokenName = ($event.target as HTMLInputElement).value"
              />
              <p
                v-if="tokenNameError !== null"
                class="au-field-error"
                data-testid="token-name-error"
              >
                {{ tokenNameError }}
              </p>
            </div>

            <div class="au-field">
              <span class="au-field__label">授权范围</span>
              <label v-for="scope in TOKEN_SCOPES" :key="scope" class="au-check">
                <input
                  type="checkbox"
                  :checked="selectedScopes.includes(scope)"
                  :value="scope"
                  :data-testid="`token-scope-${scope}`"
                  @change="toggleScope(scope)"
                />
                <span>{{ scope }}</span>
              </label>
              <p v-if="scopeError !== null" class="au-field-error" data-testid="token-scope-error">
                {{ scopeError }}
              </p>
            </div>

            <div class="au-field">
              <label class="au-field__label" for="token-expiry">过期时间（可选）</label>
              <input
                id="token-expiry"
                class="au-field__input"
                type="datetime-local"
                :value="expiresAt"
                data-testid="token-expiry-input"
                @input="expiresAt = ($event.target as HTMLInputElement).value"
              />
              <p
                v-if="expiresAtError !== null"
                class="au-field-error"
                data-testid="token-expiry-error"
              >
                {{ expiresAtError }}
              </p>
            </div>

            <AppButton
              type="submit"
              variant="primary"
              :disabled="
                creating ||
                session.csrf === null ||
                tokenNameError !== null ||
                scopeError !== null ||
                expiresAtError !== null
              "
              data-testid="token-create-submit"
            >
              {{ creating ? '创建中…' : '创建令牌' }}
            </AppButton>

            <AppStatusBadge
              v-if="createError !== null"
              tone="danger"
              data-testid="token-create-error"
            >
              {{ createError }}
            </AppStatusBadge>
          </form>
        </AppSection>
      </template>
    </template>
  </section>
</template>

<style scoped>
.au-hint {
  color: var(--color-text-secondary);
  max-width: 64ch;
}
.au-section {
  margin-bottom: var(--space-6);
}
.au-list-toolbar { display: flex; gap: var(--space-2); }
.au-one-time-secret {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  margin-bottom: var(--space-6);
  padding: var(--space-4);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
}
.au-secret-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.au-secret-value {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  word-break: break-all;
}
.au-token-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.au-token-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.au-token-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
}
.au-token-name {
  color: var(--color-text-primary);
  font-weight: 500;
}
.au-token-scopes {
  color: var(--color-text-secondary);
  font-size: 13px;
}
.au-token-attr {
  color: var(--color-text-secondary);
  font-size: 13px;
}
.au-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 720px;
}
.au-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.au-field__label {
  color: var(--color-text-primary);
  font-weight: 500;
}
.au-field__input {
  height: var(--control-height);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  font: inherit;
}
.au-field-error {
  margin: 0;
  color: var(--color-status-danger);
  font-size: 13px;
}
.au-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-primary);
}
</style>
