<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { OPERATION_ID_CANCEL_ACCOUNT_DELETION } from '@aurora/platform-contract';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import { fetchIntentLink } from '../../api/intent.js';
import AuthCard from '../../components/auth/AuthCard.vue';
import AuthFormField from '../../components/auth/AuthFormField.vue';
import AuthStatusBanner from '../../components/auth/AuthStatusBanner.vue';
import AppButton from '../../components/aurora/AppButton.vue';
import AppLink from '../../components/aurora/AppLink.vue';

type Phase = 'loading' | 'invalid-link' | 'ready' | 'submitting' | 'done' | 'error';

interface CancelDeletionResponse {
  readonly status: 'succeeded';
  readonly accountStatus: 'active';
  readonly sessionImpact: 'revoked_all';
}

const route = useRoute();
const router = useRouter();

const phase = ref<Phase>('loading');
const message = ref<string | null>(null);
const csrf = ref<string | null>(null);
const maskedEmail = ref<string | null>(null);
const currentPassword = ref('');
const started = ref(false);

function readToken(): string | null {
  const token = route.query.token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function clearTokenFromUrl(): void {
  const url = new URL(window.location.href);
  url.search = '';
  window.history.replaceState({}, '', url.toString());
}

function describeCancelError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'business_validation':
        return '该撤销链接已失效（可能已使用或已过期）。';
      case 'state_machine_conflict':
        return '账号当前不在可撤销状态。';
      case 'authorization':
        return '当前密码不正确。';
      case 'not_found':
        return '该撤销链接无效。';
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
        return '撤销未能完成，请稍后重试。';
    }
  }
  return '撤销未能完成，请稍后重试。';
}

onMounted(async () => {
  if (started.value) return;
  started.value = true;
  const token = readToken();
  if (token === null) {
    phase.value = 'invalid-link';
    return;
  }
  try {
    const intent = await fetchIntentLink('deletion_cancel', token);
    clearTokenFromUrl();
    csrf.value = intent.csrf;
    maskedEmail.value = intent.maskedEmail ?? null;
    phase.value = 'ready';
  } catch (caught) {
    clearTokenFromUrl();
    phase.value = 'error';
    message.value = describeCancelError(caught);
  }
});

async function onSubmit(): Promise<void> {
  if (phase.value !== 'ready' || csrf.value === null) return;
  phase.value = 'submitting';
  message.value = null;
  try {
    const data = await platformRequest<CancelDeletionResponse>(
      OPERATION_ID_CANCEL_ACCOUNT_DELETION,
      { body: { currentPassword: currentPassword.value, idempotencyKey: createIdempotencyKey() } },
      { scope: { type: 'public' }, csrf: csrf.value },
    );
    if (data.accountStatus === 'active' && data.sessionImpact === 'revoked_all') {
      phase.value = 'done';
      await router.push({ name: 'auth.login' });
    } else {
      phase.value = 'error';
      message.value = '撤销未能完成，请稍后重试。';
    }
  } catch (caught) {
    phase.value = 'error';
    message.value = describeCancelError(caught);
  }
}
</script>

<template>
  <AuthCard title="撤销账号注销" test-id="deletion-cancel-view">
    <AuthStatusBanner v-if="phase === 'loading'" tone="neutral">正在校验撤销链接…</AuthStatusBanner>

    <template v-else-if="phase === 'invalid-link'">
      <AuthStatusBanner tone="warning"
        >撤销链接无效或已缺失，请检查邮箱中的完整链接。</AuthStatusBanner
      >
      <p class="au-auth-switch">
        <AppLink to="/login" label="返回登录" />
      </p>
    </template>

    <template v-else-if="phase === 'ready' || phase === 'submitting'">
      <AuthStatusBanner v-if="maskedEmail !== null" tone="neutral">
        将撤销账号
        <strong>{{ maskedEmail }}</strong>
        的注销申请。
      </AuthStatusBanner>
      <p class="au-auth-hint">撤销成功后，该账号在所有设备上的会话将被终止，需要重新登录。</p>
      <form class="au-auth-form" novalidate @submit.prevent="onSubmit">
        <AuthFormField
          id="cancel-deletion-password"
          label="当前密码"
          type="password"
          autocomplete="current-password"
          :value="currentPassword"
          required
          @update:value="currentPassword = $event"
        />
        <AppButton type="submit" variant="primary" :disabled="phase !== 'ready'">
          {{ phase === 'submitting' ? '提交中…' : '撤销注销' }}
        </AppButton>
      </form>
    </template>

    <template v-else-if="phase === 'done'">
      <AuthStatusBanner tone="success">注销已撤销，请重新登录。</AuthStatusBanner>
      <p class="au-auth-switch">
        <AppLink to="/login" label="前往登录" />
      </p>
    </template>

    <template v-else-if="phase === 'error'">
      <AuthStatusBanner tone="danger">{{ message }}</AuthStatusBanner>
      <p class="au-auth-switch">
        <AppLink to="/login" label="返回登录" />
      </p>
    </template>
  </AuthCard>
</template>

<style scoped>
.au-auth-hint {
  margin: 0 0 var(--space-4);
  color: var(--color-text-secondary);
}
.au-auth-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.au-auth-switch {
  margin: var(--space-4) 0 0;
  color: var(--color-text-secondary);
}
</style>
