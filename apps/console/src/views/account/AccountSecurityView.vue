<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  OPERATION_ID_CHANGE_PASSWORD,
  OPERATION_ID_DELETE_ACCOUNT,
  OPERATION_ID_DELETE_ACCOUNT_PREFLIGHT,
  OPERATION_ID_LOGOUT,
  OPERATION_ID_REQUEST_ACCOUNT_DELETION,
} from '@aurora/platform-contract';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { executeQuery, invalidateQueryKey } from '../../api/query.js';
import { queryKey } from '../../api/query-key.js';
import { ApiError } from '../../api/errors.js';
import { describeRequestError } from '../../api/feedback.js';
import { resolveRouteTarget } from '../../contracts/route-registry.js';
import { useSessionStore } from '../../stores/session.js';
import AuthFormField from '../../components/auth/AuthFormField.vue';
import AuthStatusBanner from '../../components/auth/AuthStatusBanner.vue';
import AppButton from '../../components/aurora/AppButton.vue';
import AppLink from '../../components/aurora/AppLink.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppSection from '../../components/aurora/AppSection.vue';

interface ChangePasswordResponse {
  readonly status: 'succeeded';
  readonly sessionImpact: 'revoked_all';
}

interface DeleteAccountPreflightResponse {
  readonly status: 'ready' | 'blocked' | 'unavailable';
  readonly blockingOrganizations?: ReadonlyArray<{
    readonly organizationId: string;
    readonly organizationName: string;
    readonly organizationKind: 'personal' | 'organization';
  }>;
  readonly requiredLifecycle: {
    readonly coolingHours: number;
    readonly onlineCleanupDays: number;
    readonly auditRetentionYears: number;
    readonly backupRetentionDays: number;
  };
  readonly serverTime: string;
}

interface DeleteAccountResponse {
  readonly status: 'succeeded';
  readonly accountStatus: 'deletion_cooling';
  readonly deletionRequestedAt: string;
  readonly deletionCoolingEndsAt: string;
  readonly sessionImpact: 'revoked_all';
}

interface RequestAccountDeletionResponse {
  readonly status: 'succeeded';
  readonly maskedEmail: string;
  readonly resendAvailableAt?: string;
}

type PreflightUi = 'loading' | 'ready' | 'blocked' | 'unavailable' | 'error';

const ORGANIZATION_KIND_LABEL: Readonly<Record<string, string>> = {
  personal: '个人空间',
  organization: '组织',
};

const router = useRouter();
const session = useSessionStore();

const currentPassword = ref('');
const newPassword = ref('');
const changing = ref(false);
const changeError = ref<string | null>(null);
const loggingOut = ref(false);
const logoutError = ref<string | null>(null);

const preflightUi = ref<PreflightUi>('loading');
const preflight = ref<DeleteAccountPreflightResponse | null>(null);
const preflightError = ref<string | null>(null);
const requestingEmail = ref(false);
const emailRequested = ref(false);
const maskedEmail = ref<string | null>(null);
const emailRequestError = ref<string | null>(null);
const deletePassword = ref('');
const deleting = ref(false);
const deleteError = ref<string | null>(null);

const csrfReady = computed(() => session.csrf !== null);

function describeChangeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'business_validation':
        return '当前密码不正确。';
      case 'rate_limited':
        return '请求过于频繁，请稍后重试。';
      case 'authority_unavailable':
      case 'downstream_partial_failure':
        return '服务暂时不可用，请稍后重试。';
      case 'network_error':
        return '网络连接失败，请稍后重试。';
      case 'structural_error':
      case 'field_validation':
        return '密码不符合要求（至少 8 个字符）。';
      default:
        return '修改密码未能完成，请稍后重试。';
    }
  }
  return '修改密码未能完成，请稍后重试。';
}

function describePreflightError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.code === 'authorization') return '你没有权限执行该操作。';
    if (caught.code === 'authentication') return '登录状态已失效，请重新登录。';
  }
  return describeRequestError(caught);
}

/**
 * Map a delete-command failure to a user-facing message. The mailbox-confirmation
 * step is a backend-established `deletion_request` intent; when the command fails
 * because that confirmation is missing (404) or no longer valid (409), the user
 * must complete the emailed confirmation before the command can accept.
 */
function describeDeleteError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'authorization':
        return '当前密码不正确。';
      case 'business_validation':
      case 'not_found':
        return '请先打开邮箱中的注销确认邮件完成确认，再提交注销申请。';
      case 'state_machine_conflict':
        return '账号已处于注销流程中。';
      case 'rate_limited':
        return '请求过于频繁，请稍后重试。';
      case 'authority_unavailable':
      case 'downstream_partial_failure':
        return '服务暂时不可用，请稍后重试。';
      case 'network_error':
        return '网络连接失败，请稍后重试。';
      case 'structural_error':
      case 'field_validation':
        return '输入内容不符合要求，请检查后重试。';
      default:
        return '注销申请未能完成，请稍后重试。';
    }
  }
  return '注销申请未能完成，请稍后重试。';
}

/**
 * Map a request-deletion-email failure to a user-facing message. The step can
 * only fail on the account lifecycle (already cooling/terminated), transport
 * issues, or malformed input — the response never leaks account state beyond
 * that.
 */
function describeEmailRequestError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'state_machine_conflict':
        return '账号已处于注销流程中。';
      case 'rate_limited':
        return '请求过于频繁，请稍后重试。';
      case 'authority_unavailable':
      case 'downstream_partial_failure':
        return '服务暂时不可用，请稍后重试。';
      case 'network_error':
        return '网络连接失败，请稍后重试。';
      case 'structural_error':
      case 'field_validation':
        return '输入内容不符合要求，请检查后重试。';
      default:
        return '注销确认邮件发送失败，请稍后重试。';
    }
  }
  return '注销确认邮件发送失败，请稍后重试。';
}

async function onChangePassword(): Promise<void> {
  if (changing.value || session.csrf === null) return;
  changing.value = true;
  changeError.value = null;
  try {
    const data = await platformRequest<ChangePasswordResponse>(
      OPERATION_ID_CHANGE_PASSWORD,
      {
        body: {
          currentPassword: currentPassword.value,
          newPassword: newPassword.value,
          idempotencyKey: createIdempotencyKey(),
        },
      },
      { scope: { type: 'account' }, csrf: session.csrf },
    );
    if (data.sessionImpact === 'revoked_all') {
      // All sessions (including this one) are revoked (A5 / ADR-030). Clear client
      // state and send the user back to login.
      session.reset();
      await router.push({ name: 'auth.login' });
    }
  } catch (caught) {
    changing.value = false;
    changeError.value = describeChangeError(caught);
  }
}

async function onLogout(): Promise<void> {
  if (loggingOut.value) return;
  loggingOut.value = true;
  logoutError.value = null;
  try {
    if (session.csrf !== null) {
      await platformRequest(
        OPERATION_ID_LOGOUT,
        {},
        { scope: { type: 'account' }, csrf: session.csrf },
      );
    }
    session.reset();
    await router.push({ name: 'auth.login' });
  } catch (caught) {
    loggingOut.value = false;
    logoutError.value = describeRequestError(caught);
  }
}

/** Navigate to the org's members page where ownership can be transferred (B3). */
function membersHref(organizationId: string): string {
  const result = resolveRouteTarget({
    routeId: 'organization.members',
    pathParams: { organizationId },
    query: {},
  });
  return result.path ?? '/not-found';
}

async function runPreflight(): Promise<void> {
  preflightUi.value = 'loading';
  preflightError.value = null;
  // The preflight is cached per account scope; a manual re-check must re-read the
  // authoritative server projection (e.g. after an ownership transfer).
  invalidateQueryKey(queryKey({ type: 'account' }, OPERATION_ID_DELETE_ACCOUNT_PREFLIGHT));
  try {
    const data = await executeQuery<DeleteAccountPreflightResponse>({
      operationId: OPERATION_ID_DELETE_ACCOUNT_PREFLIGHT,
      input: {},
      scope: { type: 'account' },
    });
    if (data.status === 'blocked') {
      preflight.value = data;
      preflightUi.value = 'blocked';
      return;
    }
    if (data.status === 'unavailable') {
      preflightUi.value = 'unavailable';
      return;
    }
    preflight.value = data;
    preflightUi.value = 'ready';
  } catch (caught) {
    preflightUi.value = 'error';
    preflightError.value = describePreflightError(caught);
  }
}

onMounted(() => {
  void runPreflight();
});

async function onDeleteAccount(): Promise<void> {
  if (deleting.value || session.csrf === null) return;
  deleting.value = true;
  deleteError.value = null;
  try {
    const data = await platformRequest<DeleteAccountResponse>(
      OPERATION_ID_DELETE_ACCOUNT,
      {
        body: {
          currentPassword: deletePassword.value,
          idempotencyKey: createIdempotencyKey(),
        },
      },
      { scope: { type: 'account' }, csrf: session.csrf },
    );
    if (data.accountStatus === 'deletion_cooling' && data.sessionImpact === 'revoked_all') {
      // All sessions are revoked and the account enters the server-authoritative
      // cooling window. Clear client state; the deletion cooling end is never
      // trusted from a client timer.
      session.reset();
      await router.push({ name: 'auth.login' });
    }
  } catch (caught) {
    deleting.value = false;
    deleteError.value = describeDeleteError(caught);
  }
}

/**
 * Step one of the A5 double confirmation: send the deletion confirmation email.
 * The backend creates the `deletion_request` intent and emails the masked
 * recipient; the emailed link establishes the intent cookie in this browser so
 * the subsequent delete submit's mailbox factor is satisfied.
 */
async function onRequestDeletionEmail(): Promise<void> {
  if (requestingEmail.value || session.csrf === null) return;
  requestingEmail.value = true;
  emailRequestError.value = null;
  try {
    const data = await platformRequest<RequestAccountDeletionResponse>(
      OPERATION_ID_REQUEST_ACCOUNT_DELETION,
      { body: { idempotencyKey: createIdempotencyKey() } },
      { scope: { type: 'account' }, csrf: session.csrf },
    );
    maskedEmail.value = data.maskedEmail;
    emailRequested.value = true;
  } catch (caught) {
    emailRequestError.value = describeEmailRequestError(caught);
  } finally {
    requestingEmail.value = false;
  }
}
</script>

<template>
  <div class="account-security-page" data-testid="account-security-view">
    <AppPageHeader
      title="账号安全"
      description="管理当前账号的凭据、会话和注销申请。高风险操作须由服务端完成确认。"
    />

    <div class="account-security-work-area">
      <AppSection
        title="修改密码"
        description="修改后，该账号在所有设备上的会话将被撤销，需要重新登录。"
        test-id="account-security-password-section"
      >
        <form class="au-auth-form" novalidate @submit.prevent="onChangePassword">
          <AuthFormField
            id="security-current-password"
            label="当前密码"
            type="password"
            autocomplete="current-password"
            :value="currentPassword"
            required
            @update:value="currentPassword = $event"
          />
          <AuthFormField
            id="security-new-password"
            label="新密码"
            type="password"
            autocomplete="new-password"
            :value="newPassword"
            required
            @update:value="newPassword = $event"
          />
          <AppButton
            type="submit"
            variant="primary"
            :disabled="changing || !csrfReady"
            data-testid="change-password-button"
          >
            {{ changing ? '提交中…' : '修改密码' }}
          </AppButton>
        </form>
        <AuthStatusBanner v-if="changeError !== null" tone="danger">
          {{ changeError }}
        </AuthStatusBanner>
      </AppSection>

      <AppSection
        title="当前会话"
        description="退出仅结束当前设备的会话；其他设备仍保持其各自的会话状态。"
        test-id="account-security-session-section"
      >
        <AppButton
          variant="secondary"
          :disabled="loggingOut || !csrfReady"
          data-testid="logout-button"
          @click="onLogout"
        >
          {{ loggingOut ? '退出中…' : '退出当前会话' }}
        </AppButton>
        <AuthStatusBanner v-if="logoutError !== null" tone="danger">
          {{ logoutError }}
        </AuthStatusBanner>
      </AppSection>

      <AppSection
        title="注销账号"
        description="不可逆的账号生命周期操作。请在确认影响后继续。"
        tone="danger"
        test-id="deletion-section"
      >
        <div class="deletion-consequences">
          <p>
            申请受理后，全部会话会立即终止，账号进入 7
            天冷静期。冷静期内只能通过邮箱中的撤销链接取消申请。
          </p>
          <ul>
            <li>注销必须完成邮箱确认与当前密码确认两项身份复核。</li>
            <li>冷静期结束后，普通业务数据将匿名保留；在线数据在 7 天内清理。</li>
            <li>安全审计记录保留 1 年，备份副本最迟在 35 天内淘汰。</li>
          </ul>
        </div>

        <p
          v-if="preflightUi === 'loading'"
          class="au-hint"
          role="status"
          data-testid="deletion-preflight-loading"
        >
          正在检查注销条件…
        </p>

        <template v-else-if="preflightUi === 'blocked' && preflight !== null">
          <AuthStatusBanner tone="warning">
            你仍是以下组织的唯一所有者，需要先转让所有权才能注销账号。
          </AuthStatusBanner>
          <ul class="au-org-block-list" data-testid="deletion-org-block-list">
            <li
              v-for="org in preflight.blockingOrganizations ?? []"
              :key="org.organizationId"
              class="au-org-block-item"
              data-testid="deletion-org-block-item"
            >
              <span class="au-org-block-name" data-testid="deletion-org-name">{{
                org.organizationName
              }}</span>
              <span class="au-org-block-kind" data-testid="deletion-org-kind">
                {{ ORGANIZATION_KIND_LABEL[org.organizationKind] ?? org.organizationKind }}
              </span>
              <AppLink :to="membersHref(org.organizationId)" label="转让所有权" />
            </li>
          </ul>
          <AppButton
            variant="secondary"
            data-testid="deletion-recheck-button"
            @click="runPreflight"
          >
            重新检查
          </AppButton>
        </template>

        <template v-else-if="preflightUi === 'ready'">
          <p class="au-security-hint">
            注销需要两步确认：先在邮箱中打开注销确认邮件完成确认，再输入当前密码提交申请。
          </p>

          <template v-if="!emailRequested">
            <p class="au-security-hint">第一步：发送注销确认邮件到已验证邮箱。</p>
            <AppButton
              variant="danger"
              :disabled="requestingEmail || !csrfReady"
              data-testid="request-deletion-email-button"
              @click="onRequestDeletionEmail"
            >
              {{ requestingEmail ? '发送中…' : '发送注销确认邮件' }}
            </AppButton>
            <AuthStatusBanner
              v-if="emailRequestError !== null"
              tone="danger"
              data-testid="deletion-email-error"
            >
              {{ emailRequestError }}
            </AuthStatusBanner>
          </template>

          <template v-else>
            <AuthStatusBanner tone="neutral" data-testid="deletion-email-sent">
              注销确认邮件已发送至
              {{
                maskedEmail
              }}，请打开邮件中的链接完成确认，然后返回此处输入当前密码并提交注销申请。
            </AuthStatusBanner>
            <form class="au-auth-form" novalidate @submit.prevent="onDeleteAccount">
              <AuthFormField
                id="deletion-current-password"
                label="当前密码"
                type="password"
                autocomplete="current-password"
                :value="deletePassword"
                required
                @update:value="deletePassword = $event"
              />
              <AppButton
                type="submit"
                variant="danger"
                :disabled="deleting || !csrfReady"
                data-testid="delete-account-button"
              >
                {{ deleting ? '提交中…' : '申请注销' }}
              </AppButton>
            </form>
          </template>
        </template>

        <template v-else-if="preflightUi === 'unavailable' || preflightUi === 'error'">
          <AuthStatusBanner tone="danger" data-testid="deletion-preflight-error">
            {{ preflightError ?? '注销条件暂时无法确定，请稍后重试。' }}
          </AuthStatusBanner>
          <AppButton
            variant="secondary"
            data-testid="deletion-recheck-button"
            @click="runPreflight"
          >
            重新检查
          </AppButton>
        </template>

        <AuthStatusBanner v-if="deleteError !== null" tone="danger" data-testid="deletion-error">
          {{ deleteError }}
        </AuthStatusBanner>
      </AppSection>
    </div>
  </div>
</template>

<style scoped>
.account-security-page {
  max-width: 880px;
  margin: 0 auto;
}
.account-security-work-area {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.deletion-consequences {
  margin-bottom: var(--space-4);
  color: var(--color-text-secondary);
}
.deletion-consequences p,
.deletion-consequences ul {
  margin: 0;
}
.deletion-consequences ul {
  margin-top: var(--space-2);
  padding-left: 1.25rem;
}
.au-auth-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.au-hint {
  color: var(--color-text-secondary);
}
.au-org-block-list {
  list-style: none;
  margin: 0 0 var(--space-4);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.au-org-block-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.au-org-block-name {
  color: var(--color-text-primary);
}
.au-org-block-kind {
  color: var(--color-text-secondary);
}
@media (max-width: 640px) {
  .account-security-page {
    max-width: none;
  }
}
</style>
