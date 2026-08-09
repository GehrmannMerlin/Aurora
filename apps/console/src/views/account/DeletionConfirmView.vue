<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ApiError } from '../../api/errors.js';
import { fetchIntentLink } from '../../api/intent.js';
import AuthCard from '../../components/auth/AuthCard.vue';
import AuthStatusBanner from '../../components/auth/AuthStatusBanner.vue';
import AppLink from '../../components/aurora/AppLink.vue';

type Phase = 'loading' | 'invalid-link' | 'confirmed' | 'error';

const route = useRoute();

const phase = ref<Phase>('loading');
const message = ref<string | null>(null);
const maskedEmail = ref<string | null>(null);
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

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'business_validation':
        return '该确认链接已失效（可能已使用或已过期）。';
      case 'not_found':
        return '该确认链接无效。';
      case 'rate_limited':
        return '请求过于频繁，请稍后重试。';
      case 'authority_unavailable':
      case 'downstream_partial_failure':
        return '服务暂时不可用，请稍后重试。';
      case 'network_error':
        return '网络连接失败，请稍后重试。';
      default:
        return '确认未能完成，请稍后重试。';
    }
  }
  return '确认未能完成，请稍后重试。';
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
    // Establish the `deletion_request` intent cookie (the delete command's
    // mailbox factor). The raw token is cleared from the address bar.
    const intent = await fetchIntentLink('deletion_request', token);
    clearTokenFromUrl();
    maskedEmail.value = intent.maskedEmail ?? null;
    phase.value = 'confirmed';
  } catch (caught) {
    clearTokenFromUrl();
    phase.value = 'error';
    message.value = describeError(caught);
  }
});
</script>

<template>
  <AuthCard title="注销账号确认" test-id="deletion-confirm-view">
    <AuthStatusBanner v-if="phase === 'loading'" tone="neutral"
      >正在校验注销确认链接…</AuthStatusBanner
    >

    <template v-else-if="phase === 'invalid-link'">
      <AuthStatusBanner tone="warning"
        >注销确认链接无效或已缺失，请检查邮箱中的完整链接。</AuthStatusBanner
      >
      <p class="au-auth-switch">
        <AppLink to="/account/security" label="前往账号安全" />
      </p>
    </template>

    <template v-else-if="phase === 'confirmed'">
      <AuthStatusBanner tone="success">
        注销确认已完成
        <template v-if="maskedEmail !== null">（{{ maskedEmail }}）</template>。
      </AuthStatusBanner>
      <p class="au-auth-hint">
        请返回账号安全页面，输入当前密码并提交注销申请，账号将进入 7 天冷却期。
      </p>
      <p class="au-auth-switch">
        <AppLink to="/account/security" label="前往账号安全页完成注销" />
      </p>
    </template>

    <template v-else-if="phase === 'error'">
      <AuthStatusBanner tone="danger">{{ message }}</AuthStatusBanner>
      <p class="au-auth-switch">
        <AppLink to="/account/security" label="返回账号安全" />
      </p>
    </template>
  </AuthCard>
</template>

<style scoped>
.au-auth-hint {
  margin: 0 0 var(--space-4);
  color: var(--color-text-secondary);
}
.au-auth-switch {
  margin: var(--space-4) 0 0;
  color: var(--color-text-secondary);
}
</style>
