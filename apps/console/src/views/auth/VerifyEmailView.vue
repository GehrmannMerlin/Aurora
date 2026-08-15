<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { OPERATION_ID_RESEND_EMAIL_VERIFICATION } from '@aurora/platform-contract';
import { ApiError } from '../../api/errors.js';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { useAuthStore } from '../../stores/auth.js';
import { useSessionStore } from '../../stores/session.js';
import AuthCard from '../../components/auth/AuthCard.vue';
import AuthStatusBanner from '../../components/auth/AuthStatusBanner.vue';
import AppButton from '../../components/aurora/AppButton.vue';
import AppLink from '../../components/aurora/AppLink.vue';
import AppTechnicalDetails from '../../components/aurora/AppTechnicalDetails.vue';
import { formatUtc } from '../../monitoring/format.js';
import {
  deriveResendState,
  estimateServerNow,
  type ServerClockAnchor,
} from './email-verification-view-model.js';

interface ResendResponse {
  readonly emailMasked: string;
  readonly deliveryStatus: 'queued';
  readonly resendAvailableAt: string;
  readonly serverTime: string;
}

type ActionResult =
  | { readonly tone: 'success'; readonly message: string }
  | { readonly tone: 'warning'; readonly message: string }
  | { readonly tone: 'danger'; readonly message: string };

const authStore = useAuthStore();
const sessionStore = useSessionStore();
const { registration } = storeToRefs(authStore);
const { status: sessionStatus, account, csrf } = storeToRefs(sessionStore);

const now = ref(new Date());
const inFlight = ref(false);
const actionResult = ref<ActionResult | null>(null);
const actionSummary = ref<HTMLElement | null>(null);
const clockAnchor = ref<ServerClockAnchor | null>(
  registration.value?.serverTime === undefined
    ? null
    : { serverTime: registration.value.serverTime, observedClientTime: new Date() },
);
const resendAvailableAt = ref<string | null>(registration.value?.resendAvailableAt ?? null);
let timer: ReturnType<typeof setInterval> | undefined;

const estimatedServerNow = computed<Date>(() => {
  const anchor = clockAnchor.value;
  return anchor === null ? now.value : estimateServerNow({ ...anchor, clientNow: now.value });
});
const resendState = computed(() =>
  deriveResendState({
    serverTime: estimatedServerNow.value.toISOString(),
    resendAvailableAt: resendAvailableAt.value,
    clientNow: now.value,
  }),
);
const resendDisabled = computed(() => inFlight.value || resendState.value.kind === 'cooldown');
const maskedEmail = computed(
  () => account.value?.emailMasked ?? registration.value?.emailMasked ?? '',
);
const verificationStatusLabel = computed(() =>
  account.value?.verified === true ? '已验证' : '等待邮箱验证',
);

async function focusActionSummary(): Promise<void> {
  await nextTick();
  actionSummary.value?.focus();
}

function applyServerCooldown(input: {
  readonly serverTime: string;
  readonly resendAvailableAt: string;
}): void {
  const observedClientTime = new Date();
  now.value = observedClientTime;
  clockAnchor.value = { serverTime: input.serverTime, observedClientTime };
  resendAvailableAt.value = input.resendAvailableAt;
}

function applyRateLimit(error: ApiError): void {
  if (error.resendAvailableAt === undefined) return;
  const retrySeconds = Math.max(0, error.retryAfter ?? 0);
  applyServerCooldown({
    serverTime: new Date(Date.parse(error.resendAvailableAt) - retrySeconds * 1000).toISOString(),
    resendAvailableAt: error.resendAvailableAt,
  });
}

async function onResend(): Promise<void> {
  if (resendDisabled.value || csrf.value === null) return;
  inFlight.value = true;
  actionResult.value = null;
  try {
    const response = await platformRequest<ResendResponse>(
      OPERATION_ID_RESEND_EMAIL_VERIFICATION,
      { body: { idempotencyKey: createIdempotencyKey() } },
      { scope: { type: 'account' }, csrf: csrf.value },
    );
    applyServerCooldown(response);
    actionResult.value = {
      tone: 'success',
      message: '新的验证邮件已加入发送队列，请仅使用最新邮件中的验证链接。',
    };
  } catch (caught) {
    if (!(caught instanceof ApiError)) {
      actionResult.value = { tone: 'danger', message: '请求失败，请稍后重试。' };
    } else if (caught.code === 'authentication') {
      await sessionStore.restore({ force: true });
      actionResult.value = { tone: 'warning', message: '登录状态已失效，请重新登录。' };
    } else if (caught.code === 'state_machine_conflict') {
      await sessionStore.restore({ force: true });
      actionResult.value =
        account.value?.verified === true
          ? { tone: 'success', message: '邮箱已经完成验证。' }
          : { tone: 'warning', message: '账户状态已更新，请刷新后重试。' };
    } else if (caught.code === 'rate_limited') {
      applyRateLimit(caught);
      actionResult.value =
        caught.retryAfter !== undefined && caught.retryAfter <= 60
          ? { tone: 'warning', message: '重新发送仍在冷却中，请在倒计时结束后再试。' }
          : {
              tone: 'warning',
              message: '24 小时内的重新发送次数已达上限，请在限制解除后再试。',
            };
    } else if (caught.code === 'authority_unavailable' || caught.status === 503) {
      actionResult.value = { tone: 'danger', message: '邮件服务暂时不可用，请稍后重试。' };
    } else {
      actionResult.value = { tone: 'danger', message: '无法重新发送验证邮件，请稍后重试。' };
    }
  } finally {
    inFlight.value = false;
    await focusActionSummary();
  }
}

onMounted(async () => {
  timer = setInterval(() => {
    now.value = new Date();
  }, 1000);
  await sessionStore.restore({ force: true });
});

onBeforeUnmount(() => {
  if (timer !== undefined) clearInterval(timer);
});
</script>

<template>
  <AuthCard title="邮箱验证" test-id="verify-email-view">
    <AuthStatusBanner v-if="sessionStatus === 'idle' || sessionStatus === 'loading'" tone="neutral">
      正在恢复验证状态…
    </AuthStatusBanner>

    <AuthStatusBanner v-else-if="sessionStatus === 'unauthenticated'" tone="warning">
      未找到可用的注册交接或登录会话。
      <AppLink to="/login" label="返回登录" />
      或
      <AppLink to="/register" label="重新注册" />
    </AuthStatusBanner>

    <AuthStatusBanner v-else-if="sessionStatus === 'unavailable'" tone="danger">
      暂时无法恢复验证状态，请刷新页面重试。
    </AuthStatusBanner>

    <template v-else-if="account?.verified === true">
      <div ref="actionSummary" tabindex="-1" class="au-verify-focus-summary">
        <AuthStatusBanner tone="success">当前账号邮箱已验证。</AuthStatusBanner>
      </div>
      <p class="au-auth-switch">
        <AppLink to="/workspace" label="继续工作空间" />
      </p>
    </template>

    <template v-else>
      <AuthStatusBanner tone="neutral">
        账户 <strong>{{ maskedEmail }}</strong> 正在等待邮箱验证。
      </AuthStatusBanner>
      <dl class="au-verify-meta">
        <div class="au-verify-meta__row">
          <dt>验证状态</dt>
          <dd data-testid="verify-status">{{ verificationStatusLabel }}</dd>
        </div>
        <div v-if="registration !== null" class="au-verify-meta__row">
          <dt>服务器时间</dt>
          <dd data-testid="verify-server-time">{{ formatUtc(registration.serverTime) }}</dd>
        </div>
        <div v-if="resendAvailableAt !== null" class="au-verify-meta__row">
          <dt>可重新发送</dt>
          <dd data-testid="verify-resend-at">{{ formatUtc(resendAvailableAt) }}</dd>
        </div>
      </dl>
      <AppTechnicalDetails v-if="registration !== null" summary="技术详情"
        >验证状态键: {{ registration.verificationStatus.reason }} 服务器时间 (UTC):
        {{ registration.serverTime }}
        <template v-if="resendAvailableAt !== null"
          >可重新发送时间 (UTC): {{ resendAvailableAt }}</template
        ></AppTechnicalDetails
      >
      <p class="au-verify-help">如果没有收到邮件，可以在下方重新发送。最新验证链接唯一有效。</p>
      <AppButton
        variant="secondary"
        :disabled="resendDisabled"
        data-testid="resend-button"
        @click="onResend"
      >
        <template v-if="inFlight">发送中…</template>
        <template v-else-if="resendState.kind === 'cooldown'">
          重新发送（{{ resendState.remainingSeconds }} 秒）
        </template>
        <template v-else>重新发送验证邮件</template>
      </AppButton>

      <div
        v-if="actionResult !== null"
        ref="actionSummary"
        tabindex="-1"
        class="au-verify-focus-summary"
      >
        <AuthStatusBanner :tone="actionResult.tone" live>
          {{ actionResult.message }}
        </AuthStatusBanner>
      </div>

      <p class="au-auth-switch">
        已验证？
        <AppLink to="/workspace" label="进入工作空间" />
      </p>
    </template>
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
.au-verify-help {
  margin: var(--space-4) 0;
  color: var(--color-text-secondary);
}
.au-verify-focus-summary {
  margin-top: var(--space-4);
  outline: none;
}
.au-auth-switch {
  margin: var(--space-4) 0 0;
  color: var(--color-text-secondary);
}
</style>
