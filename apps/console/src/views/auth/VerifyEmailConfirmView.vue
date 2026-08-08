<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { OPERATION_ID_CONFIRM_EMAIL_VERIFICATION } from '@aurora/platform-contract';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import { fetchIntentLink } from '../../api/intent.js';
import AuthCard from '../../components/auth/AuthCard.vue';
import AuthStatusBanner from '../../components/auth/AuthStatusBanner.vue';
import AppButton from '../../components/aurora/AppButton.vue';
import AppLink from '../../components/aurora/AppLink.vue';

type Phase = 'loading' | 'invalid-link' | 'ready' | 'confirming' | 'verified' | 'error';

const route = useRoute();

const phase = ref<Phase>('loading');
const message = ref<string | null>(null);
const maskedEmail = ref<string | null>(null);
const verifiedEmail = ref<string | null>(null);
const csrf = ref<string | null>(null);
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

onMounted(async () => {
  if (started.value) return;
  started.value = true;
  const token = readToken();
  if (token === null) {
    phase.value = 'invalid-link';
    return;
  }
  try {
    const intent = await fetchIntentLink('email_verification', token);
    clearTokenFromUrl();
    csrf.value = intent.csrf;
    maskedEmail.value = intent.maskedEmail ?? null;
    phase.value = 'ready';
  } catch (caught) {
    clearTokenFromUrl();
    phase.value = 'error';
    message.value = describeConfirmError(caught);
  }
});

function describeConfirmError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'business_validation':
        return '该验证链接已失效（可能已使用或已过期）。';
      case 'not_found':
        return '该验证链接无效。';
      case 'rate_limited':
        return '请求过于频繁，请稍后重试。';
      case 'authority_unavailable':
      case 'downstream_partial_failure':
        return '服务暂时不可用，请稍后重试。';
      case 'network_error':
        return '网络连接失败，请稍后重试。';
      default:
        return '验证未能完成，请稍后重试。';
    }
  }
  return '验证未能完成，请稍后重试。';
}

async function onConfirm(): Promise<void> {
  if (phase.value !== 'ready' || csrf.value === null) return;
  phase.value = 'confirming';
  message.value = null;
  try {
    const data = await platformRequest<{
      verificationStatus: { verified: true };
      account: { accountId: string; email: string; verified: true };
    }>(
      OPERATION_ID_CONFIRM_EMAIL_VERIFICATION,
      { body: { idempotencyKey: createIdempotencyKey() } },
      { scope: { type: 'account' }, csrf: csrf.value },
    );
    verifiedEmail.value = data.account.email;
    phase.value = 'verified';
  } catch (caught) {
    phase.value = 'error';
    message.value = describeConfirmError(caught);
  }
}
</script>

<template>
  <AuthCard title="确认邮箱验证" test-id="verify-email-confirm-view">
    <AuthStatusBanner v-if="phase === 'loading'" tone="neutral">正在校验验证链接…</AuthStatusBanner>

    <template v-else-if="phase === 'invalid-link'">
      <AuthStatusBanner tone="warning">验证链接无效或已缺失，请检查邮箱中的完整链接。</AuthStatusBanner>
      <p class="au-auth-switch">
        <AppLink to="/login" label="返回登录" />
      </p>
    </template>

    <template v-else-if="phase === 'ready'">
      <AuthStatusBanner v-if="maskedEmail !== null" tone="neutral">
        确认 <strong>{{ maskedEmail }}</strong> 的邮箱验证。
      </AuthStatusBanner>
      <AppButton
        variant="primary"
        :disabled="phase !== 'ready'"
        data-testid="confirm-email-button"
        @click="onConfirm"
      >
        确认邮箱
      </AppButton>
    </template>

    <template v-else-if="phase === 'verified'">
      <AuthStatusBanner tone="success">
        邮箱已验证：<strong>{{ verifiedEmail }}</strong>
      </AuthStatusBanner>
      <p class="au-auth-switch">
        <AppLink to="/workspace" label="进入工作空间" />
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
.au-auth-switch {
  margin: var(--space-4) 0 0;
  color: var(--color-text-secondary);
}
</style>
