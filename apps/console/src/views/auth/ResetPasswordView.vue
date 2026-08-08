<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { OPERATION_ID_CONFIRM_PASSWORD_RESET } from '@aurora/platform-contract';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import { fetchIntentLink } from '../../api/intent.js';
import AuthCard from '../../components/auth/AuthCard.vue';
import AuthFormField from '../../components/auth/AuthFormField.vue';
import AuthStatusBanner from '../../components/auth/AuthStatusBanner.vue';
import AppButton from '../../components/aurora/AppButton.vue';
import AppLink from '../../components/aurora/AppLink.vue';

type Phase = 'loading' | 'invalid-link' | 'ready' | 'submitting' | 'done' | 'error';

const route = useRoute();
const router = useRouter();

const phase = ref<Phase>('loading');
const message = ref<string | null>(null);
const csrf = ref<string | null>(null);
const newPassword = ref('');
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

function describeResetError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'business_validation':
        return '该重置链接已失效（可能已使用或已过期）。';
      case 'not_found':
        return '该重置链接无效。';
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
        return '重置未能完成，请稍后重试。';
    }
  }
  return '重置未能完成，请稍后重试。';
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
    const intent = await fetchIntentLink('password_reset', token);
    clearTokenFromUrl();
    csrf.value = intent.csrf;
    phase.value = 'ready';
  } catch (caught) {
    clearTokenFromUrl();
    phase.value = 'error';
    message.value = describeResetError(caught);
  }
});

async function onSubmit(): Promise<void> {
  if (phase.value !== 'ready' || csrf.value === null) return;
  phase.value = 'submitting';
  message.value = null;
  try {
    await platformRequest<{ status: 'succeeded'; serverTime: string }>(
      OPERATION_ID_CONFIRM_PASSWORD_RESET,
      { body: { newPassword: newPassword.value, idempotencyKey: createIdempotencyKey() } },
      { scope: { type: 'public' }, csrf: csrf.value },
    );
    phase.value = 'done';
    await router.push({ name: 'auth.login' });
  } catch (caught) {
    phase.value = 'error';
    message.value = describeResetError(caught);
  }
}
</script>

<template>
  <AuthCard title="重置密码" test-id="reset-password-view">
    <AuthStatusBanner v-if="phase === 'loading'" tone="neutral">正在校验重置链接…</AuthStatusBanner>

    <template v-else-if="phase === 'invalid-link'">
      <AuthStatusBanner tone="warning">重置链接无效或已缺失，请检查邮箱中的完整链接。</AuthStatusBanner>
      <p class="au-auth-switch">
        <AppLink to="/login" label="返回登录" />
      </p>
    </template>

    <template v-else-if="phase === 'ready' || phase === 'submitting'">
      <form class="au-auth-form" novalidate @submit.prevent="onSubmit">
        <AuthFormField
          id="reset-password"
          label="新密码"
          type="password"
          autocomplete="new-password"
          :value="newPassword"
          required
          @update:value="newPassword = $event"
        />
        <AppButton type="submit" variant="primary" :disabled="phase !== 'ready'">
          {{ phase === 'submitting' ? '提交中…' : '设置新密码' }}
        </AppButton>
      </form>
    </template>

    <template v-else-if="phase === 'done'">
      <AuthStatusBanner tone="success">密码已重置，请使用新密码登录。</AuthStatusBanner>
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
