<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '../../stores/auth.js';
import AuthCard from '../../components/auth/AuthCard.vue';
import AuthStatusBanner from '../../components/auth/AuthStatusBanner.vue';
import AppButton from '../../components/aurora/AppButton.vue';
import AppLink from '../../components/aurora/AppLink.vue';

const authStore = useAuthStore();
const { registration } = storeToRefs(authStore);

const cooldownActive = computed<boolean>(() => {
  const resend = registration.value?.resendAvailableAt;
  const serverTime = registration.value?.serverTime;
  if (resend === undefined || serverTime === undefined) return false;
  return Date.parse(resend) > Date.parse(serverTime);
});

const cooldownLabel = computed<string | null>(() => {
  const resend = registration.value?.resendAvailableAt;
  if (resend === undefined) return null;
  return new Date(resend).toLocaleTimeString();
});

const resendNotice = ref(false);

function onResend(): void {
  // The 8-operation PLT-03 contract has no resend operation. The button respects
  // the server cooldown and never fabricates a delivery; clicking it outside the
  // cooldown surfaces an honest capability-gap notice instead of faking success.
  resendNotice.value = true;
}
</script>

<template>
  <AuthCard title="邮箱验证" test-id="verify-email-view">
    <template v-if="registration !== null">
      <AuthStatusBanner tone="neutral">
        我们已向 <strong>{{ registration.emailMasked }}</strong> 发送了一封验证邮件。
      </AuthStatusBanner>
      <dl class="au-verify-meta">
        <div class="au-verify-meta__row">
          <dt>验证状态</dt>
          <dd data-testid="verify-status">{{ registration.verificationStatus.reason }}</dd>
        </div>
        <div class="au-verify-meta__row">
          <dt>服务器时间</dt>
          <dd data-testid="verify-server-time">{{ registration.serverTime }}</dd>
        </div>
        <div v-if="registration.resendAvailableAt !== undefined" class="au-verify-meta__row">
          <dt>可重新发送</dt>
          <dd data-testid="verify-resend-at">{{ registration.resendAvailableAt }}</dd>
        </div>
      </dl>
      <AppButton
        variant="secondary"
        :disabled="cooldownActive"
        data-testid="resend-button"
        @click="onResend"
      >
        {{
          cooldownActive && cooldownLabel !== null
            ? `重新发送（${cooldownLabel} 后可用）`
            : '重新发送验证邮件'
        }}
      </AppButton>
      <AuthStatusBanner v-if="resendNotice" tone="warning">
        重新发送功能将在后续版本提供；当前版本不会伪造新的邮件发送。
      </AuthStatusBanner>
      <p class="au-auth-switch">
        已验证？
        <AppLink to="/workspace" label="进入工作空间" />
      </p>
    </template>
    <AuthStatusBanner v-else tone="warning">
      未找到注册信息。
      <AppLink to="/register" label="重新注册" />
    </AuthStatusBanner>
  </AuthCard>
</template>

<style scoped>
.au-verify-meta {
  margin: var(--space-4) 0;
}
.au-verify-meta__row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border-default);
}
.au-verify-meta__row dt {
  color: var(--color-text-secondary);
}
.au-verify-meta__row dd {
  margin: 0;
  color: var(--color-text-primary);
}
.au-auth-switch {
  margin: var(--space-4) 0 0;
  color: var(--color-text-secondary);
}
</style>
