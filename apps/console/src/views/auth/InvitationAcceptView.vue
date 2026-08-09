<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  OPERATION_ID_ACCEPT_INVITATION,
  OPERATION_ID_LOGOUT,
  type RouteTargetId,
} from '@aurora/platform-contract';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import { fetchIntentLink } from '../../api/intent.js';
import { resolveRouteTarget } from '../../contracts/route-registry.js';
import { useSessionStore } from '../../stores/session.js';
import AuthCard from '../../components/auth/AuthCard.vue';
import AuthStatusBanner from '../../components/auth/AuthStatusBanner.vue';
import AppButton from '../../components/aurora/AppButton.vue';
import AppLink from '../../components/aurora/AppLink.vue';

type Phase =
  | 'loading'
  | 'invalid-link'
  | 'ready'
  | 'submitting'
  | 'accepted'
  | 'mismatch'
  | 'login-required'
  | 'error';

interface AcceptResponse {
  readonly organization: {
    readonly organizationId: string;
    readonly name: string;
    readonly role: 'owner' | 'admin' | 'member';
  };
  readonly navigationTargets: ReadonlyArray<{
    routeId: string;
    pathParams: Readonly<Record<string, string>>;
    query: Readonly<Record<string, string>>;
  }>;
}

const ROLE_LABEL: Readonly<Record<'owner' | 'admin' | 'member', string>> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
};

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const phase = ref<Phase>('loading');
const message = ref<string | null>(null);
const mismatchMessage = ref<string | null>(null);
const csrf = ref<string | null>(null);
const maskedEmail = ref<string | null>(null);
const organizationName = ref<string | null>(null);
const role = ref<'owner' | 'admin' | 'member' | null>(null);
const acceptResponse = ref<AcceptResponse | null>(null);
const started = ref(false);

const roleLabel = computed<string>(() => (role.value === null ? '' : ROLE_LABEL[role.value]));

const acceptedPath = computed<string>(() => {
  const target = acceptResponse.value?.navigationTargets[0];
  if (target === undefined) return '/workspace';
  const resolved = resolveRouteTarget({
    routeId: target.routeId as RouteTargetId,
    pathParams: target.pathParams as Readonly<Record<string, string>>,
    query: target.query as Readonly<Record<string, string>>,
  });
  return resolved.path ?? '/workspace';
});

function readToken(): string | null {
  const token = route.query.token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function clearTokenFromUrl(): void {
  const url = new URL(window.location.href);
  url.search = '';
  window.history.replaceState({}, '', url.toString());
}

function describeAcceptError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'rate_limited':
        return '请求过于频繁，请稍后重试。';
      case 'authority_unavailable':
      case 'downstream_partial_failure':
        return '服务暂时不可用，请稍后重试。';
      case 'network_error':
        return '网络连接失败，请稍后重试。';
      default:
        return '接受邀请未能完成，请稍后重试。';
    }
  }
  return '接受邀请未能完成，请稍后重试。';
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
    const intent = await fetchIntentLink('organization_invitation', token);
    clearTokenFromUrl();
    csrf.value = intent.csrf;
    maskedEmail.value = intent.maskedEmail ?? null;
    organizationName.value = intent.organizationName ?? null;
    role.value = intent.role ?? null;
    phase.value = 'ready';
  } catch (caught) {
    clearTokenFromUrl();
    phase.value = 'error';
    message.value = describeAcceptError(caught);
  }
});

async function onAccept(): Promise<void> {
  if (phase.value !== 'ready' || csrf.value === null) return;
  if (session.status === 'idle' || session.status === 'unauthenticated') {
    await session.restore();
  }
  if (session.csrf === null) {
    phase.value = 'login-required';
    return;
  }
  phase.value = 'submitting';
  message.value = null;
  try {
    const data = await platformRequest<AcceptResponse>(
      OPERATION_ID_ACCEPT_INVITATION,
      { body: { idempotencyKey: createIdempotencyKey() } },
      { scope: { type: 'account' }, csrf: session.csrf },
    );
    acceptResponse.value = data;
    phase.value = 'accepted';
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === 'not_found') {
      // Email mismatch (or invalid intent): reveal only the masked invited email and a
      // switch-account action — never org details (anti-enumeration, A4).
      phase.value = 'mismatch';
      mismatchMessage.value = caught.message;
      return;
    }
    if (caught instanceof ApiError && caught.code === 'authentication') {
      phase.value = 'login-required';
      return;
    }
    phase.value = 'error';
    message.value = describeAcceptError(caught);
  }
}

async function onSwitchAccount(): Promise<void> {
  // User-initiated sign-out: never auto-logout (A4). Log out explicitly, then land on login.
  if (session.csrf !== null) {
    try {
      await platformRequest(
        OPERATION_ID_LOGOUT,
        {},
        { scope: { type: 'account' }, csrf: session.csrf },
      );
    } catch {
      // best-effort; client state is cleared below regardless
    }
  }
  session.reset();
  await router.push({ name: 'auth.login' });
}
</script>

<template>
  <AuthCard title="接受邀请" test-id="invitation-accept-view">
    <AuthStatusBanner v-if="phase === 'loading'" tone="neutral">正在校验邀请链接…</AuthStatusBanner>

    <template v-else-if="phase === 'invalid-link'">
      <AuthStatusBanner tone="warning"
        >邀请链接无效或已缺失，请检查邮件中的完整链接。</AuthStatusBanner
      >
      <p class="au-auth-switch">
        <AppLink to="/login" label="返回登录" />
      </p>
    </template>

    <template v-else-if="phase === 'ready' || phase === 'submitting'">
      <AuthStatusBanner v-if="maskedEmail !== null" tone="neutral">
        你被邀请加入
        <strong>{{ organizationName ?? '该组织' }}</strong>
        （邀请发送至 <strong>{{ maskedEmail }}</strong
        >）。
      </AuthStatusBanner>
      <dl class="au-invite-meta">
        <div class="au-invite-meta__row">
          <dt>组织</dt>
          <dd data-testid="invite-org">{{ organizationName ?? '—' }}</dd>
        </div>
        <div class="au-invite-meta__row">
          <dt>角色</dt>
          <dd data-testid="invite-role">{{ roleLabel || '—' }}</dd>
        </div>
      </dl>
      <AppButton
        variant="primary"
        :disabled="phase !== 'ready'"
        data-testid="accept-invitation-button"
        @click="onAccept"
      >
        {{ phase === 'submitting' ? '接受中…' : '接受邀请' }}
      </AppButton>
    </template>

    <template v-else-if="phase === 'accepted' && acceptResponse !== null">
      <AuthStatusBanner tone="success">
        你已加入
        <strong>{{ acceptResponse.organization.name }}</strong>
        ，角色：{{ ROLE_LABEL[acceptResponse.organization.role] }}。
      </AuthStatusBanner>
      <p class="au-auth-switch">
        <AppLink :to="acceptedPath" label="进入工作空间" />
      </p>
    </template>

    <template v-else-if="phase === 'mismatch'">
      <AuthStatusBanner tone="warning">
        {{ mismatchMessage }} 请切换到被邀请的账号后重试。
      </AuthStatusBanner>
      <AppButton variant="secondary" data-testid="switch-account-button" @click="onSwitchAccount">
        切换账号
      </AppButton>
    </template>

    <template v-else-if="phase === 'login-required'">
      <AuthStatusBanner tone="warning">接受邀请需要先登录。</AuthStatusBanner>
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
.au-invite-meta {
  margin: var(--space-4) 0;
}
.au-invite-meta__row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border-default);
}
.au-invite-meta__row dt {
  color: var(--color-text-secondary);
}
.au-invite-meta__row dd {
  margin: 0;
  color: var(--color-text-primary);
}
.au-auth-switch {
  margin: var(--space-4) 0 0;
  color: var(--color-text-secondary);
}
</style>
