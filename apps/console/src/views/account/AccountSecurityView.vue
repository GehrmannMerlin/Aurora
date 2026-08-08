<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { OPERATION_ID_CHANGE_PASSWORD, OPERATION_ID_LOGOUT } from '@aurora/platform-contract';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import { describeRequestError } from '../../api/feedback.js';
import { useSessionStore } from '../../stores/session.js';
import AuthCard from '../../components/auth/AuthCard.vue';
import AuthFormField from '../../components/auth/AuthFormField.vue';
import AuthStatusBanner from '../../components/auth/AuthStatusBanner.vue';
import AppButton from '../../components/aurora/AppButton.vue';

interface ChangePasswordResponse {
  readonly status: 'succeeded';
  readonly sessionImpact: 'revoked_all';
}

const router = useRouter();
const session = useSessionStore();

const currentPassword = ref('');
const newPassword = ref('');
const changing = ref(false);
const changeError = ref<string | null>(null);
const loggingOut = ref(false);
const logoutError = ref<string | null>(null);

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
      await platformRequest(OPERATION_ID_LOGOUT, {}, { scope: { type: 'account' }, csrf: session.csrf });
    }
    session.reset();
    await router.push({ name: 'auth.login' });
  } catch (caught) {
    loggingOut.value = false;
    logoutError.value = describeRequestError(caught);
  }
}
</script>

<template>
  <AuthCard title="账号安全" test-id="account-security-view">
    <section class="au-security-section">
      <h2 class="au-security-title">修改密码</h2>
      <p class="au-security-hint">修改后，该账号在所有设备上的会话将被撤销，需要重新登录。</p>
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
    </section>

    <section class="au-security-section">
      <h2 class="au-security-title">退出登录</h2>
      <p class="au-security-hint">退出当前设备的会话。</p>
      <AppButton
        variant="danger"
        :disabled="loggingOut || !csrfReady"
        data-testid="logout-button"
        @click="onLogout"
      >
        {{ loggingOut ? '退出中…' : '退出登录' }}
      </AppButton>
      <AuthStatusBanner v-if="logoutError !== null" tone="danger">
        {{ logoutError }}
      </AuthStatusBanner>
    </section>
  </AuthCard>
</template>

<style scoped>
.au-security-section {
  margin-bottom: var(--space-5);
}
.au-security-title {
  margin: 0 0 var(--space-2);
  font-size: 16px;
  color: var(--color-text-primary);
}
.au-security-hint {
  margin: 0 0 var(--space-4);
  color: var(--color-text-secondary);
}
.au-auth-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
</style>
