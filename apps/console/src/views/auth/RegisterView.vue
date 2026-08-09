<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { OPERATION_ID_REGISTER } from '@aurora/platform-contract';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { describeRequestError } from '../../api/feedback.js';
import { useAuthStore, type RegisterResult } from '../../stores/auth.js';
import AuthCard from '../../components/auth/AuthCard.vue';
import AuthFormField from '../../components/auth/AuthFormField.vue';
import AuthStatusBanner from '../../components/auth/AuthStatusBanner.vue';
import AppButton from '../../components/aurora/AppButton.vue';
import AppLink from '../../components/aurora/AppLink.vue';

const router = useRouter();
const authStore = useAuthStore();

const email = ref('');
const password = ref('');
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  errorMessage.value = null;
  try {
    const data = await platformRequest<RegisterResult>(
      OPERATION_ID_REGISTER,
      {
        body: {
          email: email.value,
          password: password.value,
          idempotencyKey: createIdempotencyKey(),
        },
      },
      { scope: { type: 'public' } },
    );
    authStore.setRegistration(data);
    await router.push({ name: 'auth.verify-email' });
  } catch (caught) {
    submitting.value = false;
    errorMessage.value = describeRequestError(caught);
  }
}
</script>

<template>
  <AuthCard title="注册" test-id="register-view">
    <form class="au-auth-form" novalidate @submit.prevent="onSubmit">
      <AuthFormField
        id="register-email"
        label="邮箱"
        type="email"
        autocomplete="email"
        :value="email"
        required
        @update:value="email = $event"
      />
      <AuthFormField
        id="register-password"
        label="密码"
        type="password"
        autocomplete="new-password"
        :value="password"
        required
        @update:value="password = $event"
      />
      <AppButton type="submit" variant="primary" :disabled="submitting">
        {{ submitting ? '注册中…' : '注册' }}
      </AppButton>
    </form>
    <AuthStatusBanner v-if="errorMessage !== null" tone="danger">
      {{ errorMessage }}
    </AuthStatusBanner>
    <p class="au-auth-switch">
      已有账号？
      <AppLink to="/login" label="登录" />
    </p>
  </AuthCard>
</template>

<style scoped>
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
</style>
