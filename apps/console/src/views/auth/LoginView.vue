<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { OPERATION_ID_LOGIN, type RouteTargetId } from '@aurora/platform-contract';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import { resolveRouteTarget } from '../../contracts/route-registry.js';
import { useSessionStore } from '../../stores/session.js';
import AuthCard from '../../components/auth/AuthCard.vue';
import AuthFormField from '../../components/auth/AuthFormField.vue';
import AuthStatusBanner from '../../components/auth/AuthStatusBanner.vue';
import AppButton from '../../components/aurora/AppButton.vue';
import AppLink from '../../components/aurora/AppLink.vue';

interface LoginResponse {
  readonly account: { accountId: string; email: string; verified: boolean };
  readonly authentication: 'pending_verification' | 'authenticated' | 'restricted';
  readonly session: { expiresAt: string; rotationDueAt?: string };
  readonly csrf: string;
  readonly navigation: ReadonlyArray<{
    routeId: string;
    pathParams: Readonly<Record<string, string>>;
    query: Readonly<Record<string, string>>;
  }>;
  readonly continuation?: {
    target: {
      routeId: string;
      pathParams: Readonly<Record<string, string>>;
      query: Readonly<Record<string, string>>;
    };
    kind: 'invitation' | 'return_to';
  };
}

const router = useRouter();
const session = useSessionStore();

const email = ref('');
const password = ref('');
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

function describeLoginError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'authentication':
        // Uniform message: never reveals whether the account exists (anti-enumeration).
        return '邮箱或密码不正确。';
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
        return '登录未能完成，请稍后重试。';
    }
  }
  return '登录未能完成，请稍后重试。';
}

function continuationPath(data: LoginResponse): string {
  const target = data.continuation?.target ?? data.navigation[0];
  if (target === undefined) return '/workspace';
  const resolved = resolveRouteTarget({
    routeId: target.routeId as RouteTargetId,
    pathParams: target.pathParams as Readonly<Record<string, string>>,
    query: target.query as Readonly<Record<string, string>>,
  });
  return resolved.path ?? '/workspace';
}

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  errorMessage.value = null;
  try {
    const data = await platformRequest<LoginResponse>(
      OPERATION_ID_LOGIN,
      {
        body: {
          email: email.value,
          password: password.value,
          idempotencyKey: createIdempotencyKey(),
        },
      },
      { scope: { type: 'public' } },
    );
    session.applyAuthenticated(data);
    await router.push(continuationPath(data));
  } catch (caught) {
    submitting.value = false;
    errorMessage.value = describeLoginError(caught);
  }
}
</script>

<template>
  <AuthCard title="登录" test-id="login-view">
    <form class="au-auth-form" novalidate @submit.prevent="onSubmit">
      <AuthFormField
        id="login-email"
        label="邮箱"
        type="email"
        autocomplete="email"
        :value="email"
        required
        @update:value="email = $event"
      />
      <AuthFormField
        id="login-password"
        label="密码"
        type="password"
        autocomplete="current-password"
        :value="password"
        required
        @update:value="password = $event"
      />
      <AppButton type="submit" variant="primary" :disabled="submitting">
        {{ submitting ? '登录中…' : '登录' }}
      </AppButton>
    </form>
    <AuthStatusBanner v-if="errorMessage !== null" tone="danger">
      {{ errorMessage }}
    </AuthStatusBanner>
    <p class="au-auth-switch">
      没有账号？
      <AppLink to="/register" label="注册" />
      <span aria-hidden="true"> · </span>
      <AppLink to="/forgot-password" label="忘记密码" />
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
