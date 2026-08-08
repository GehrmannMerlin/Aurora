<script setup lang="ts">
import { ref } from 'vue';
import { OPERATION_ID_REQUEST_PASSWORD_RESET } from '@aurora/platform-contract';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { describeRequestError } from '../../api/feedback.js';
import AuthCard from '../../components/auth/AuthCard.vue';
import AuthFormField from '../../components/auth/AuthFormField.vue';
import AuthStatusBanner from '../../components/auth/AuthStatusBanner.vue';
import AppButton from '../../components/aurora/AppButton.vue';
import AppLink from '../../components/aurora/AppLink.vue';

interface RequestResetResponse {
  readonly serverTime: string;
  readonly nextRequestAllowedAt?: string;
}

const email = ref('');
const submitting = ref(false);
const submitted = ref(false);
const result = ref<RequestResetResponse | null>(null);
const errorMessage = ref<string | null>(null);

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  errorMessage.value = null;
  try {
    const data = await platformRequest<RequestResetResponse>(
      OPERATION_ID_REQUEST_PASSWORD_RESET,
      { body: { email: email.value, idempotencyKey: createIdempotencyKey() } },
      { scope: { type: 'public' } },
    );
    result.value = data;
    submitted.value = true;
  } catch (caught) {
    errorMessage.value = describeRequestError(caught);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthCard title="忘记密码" test-id="forgot-password-view">
    <template v-if="!submitted">
      <p class="au-auth-hint">输入注册邮箱，我们将发送密码重置链接。</p>
      <form class="au-auth-form" novalidate @submit.prevent="onSubmit">
        <AuthFormField
          id="forgot-email"
          label="邮箱"
          type="email"
          autocomplete="email"
          :value="email"
          required
          @update:value="email = $event"
        />
        <AppButton type="submit" variant="primary" :disabled="submitting">
          {{ submitting ? '发送中…' : '发送重置链接' }}
        </AppButton>
      </form>
      <AuthStatusBanner v-if="errorMessage !== null" tone="danger">
        {{ errorMessage }}
      </AuthStatusBanner>
    </template>
    <template v-else>
      <!-- Uniform success: never reveals whether the account exists (anti-enumeration). -->
      <AuthStatusBanner tone="success" data-testid="reset-requested">
        如果该邮箱已注册，我们已发送一封密码重置邮件。
      </AuthStatusBanner>
      <dl class="au-reset-meta">
        <div class="au-reset-meta__row">
          <dt>服务器时间</dt>
          <dd data-testid="reset-server-time">{{ result?.serverTime }}</dd>
        </div>
        <div v-if="result?.nextRequestAllowedAt !== undefined" class="au-reset-meta__row">
          <dt>可再次请求</dt>
          <dd data-testid="reset-next-allowed">{{ result.nextRequestAllowedAt }}</dd>
        </div>
      </dl>
    </template>
    <p class="au-auth-switch">
      <AppLink to="/login" label="返回登录" />
    </p>
  </AuthCard>
</template>

<style scoped>
.au-auth-hint {
  color: var(--color-text-secondary);
  margin: 0 0 var(--space-4);
}
.au-auth-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.au-auth-switch {
  margin: var(--space-4) 0 0;
  color: var(--color-text-secondary);
}
.au-reset-meta {
  margin: var(--space-4) 0 0;
}
.au-reset-meta__row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border-default);
}
.au-reset-meta__row dt {
  color: var(--color-text-secondary);
}
.au-reset-meta__row dd {
  margin: 0;
  color: var(--color-text-primary);
}
</style>
