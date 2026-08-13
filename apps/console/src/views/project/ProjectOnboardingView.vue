<script setup lang="ts">
/**
 * C1 项目接入（`project.onboarding`，PLT-05）。
 *
 * 第一层接入链状态全部来自 `diagnosticsGetDataStatus`（DAT-20）服务端组合的
 * `summary`/`stages`/`credential`/`queryable`/`actionTargets`。`received ≠
 * processed ≠ queryable` 严格分开；HTTP accepted 绝不显示为处理完成。PRD
 * 首次创建响应通过 history state 一次性交付真实浏览器上报密钥；页面只在指定
 * 测试错误已 processed 且可从 Issues 查询到时显示“接入成功”。自动检查最长
 * 60 秒，之后停止并保留手动重新检查入口。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { invalidateScope } from '../../api/query.js';
import {
  actionTargetHref,
  type DiagnosisData,
  type StageFacts,
} from '../../monitoring/diagnosis.js';
import { formatCount, formatUtc } from '../../monitoring/format.js';
import { fetchDataStatus, fetchIssueList } from '../../monitoring/queries.js';
import { defaultTimeRange } from '../../monitoring/time-range.js';
import { resolveRouteTarget } from '../../contracts/route-registry.js';
import { toSectionView } from '../../monitoring/section.js';
import AppLink from '../../components/aurora/AppLink.vue';
import AppButton from '../../components/aurora/AppButton.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';
import { onboardingStatusLine } from './onboarding-view-model.js';

const route = useRoute();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const TEST_ERROR_TITLE = 'Aurora Acceptance Test Error';
const POLL_INTERVAL_MS = 3_000;
const POLL_LIMIT_MS = 60_000;

type PackageManager = 'npm' | 'pnpm' | 'yarn';
type CheckState = 'idle' | 'checking' | 'connected' | 'timeout';
type SendState = 'idle' | 'sending' | 'accepted' | 'error';

const historyState =
  typeof window === 'undefined' ? null : (window.history.state as Record<string, unknown> | null);
const clientKey =
  typeof historyState?.clientKey === 'string' && historyState.clientKey.startsWith('aurora_ingest_')
    ? historyState.clientKey
    : null;
const environment =
  typeof historyState?.environment === 'string' ? historyState.environment : 'production';
const packageManager = ref<PackageManager>('npm');
const checkState = ref<CheckState>('idle');
const sendState = ref<SendState>('idle');
const sendError = ref<string | null>(null);
const testIssueId = ref<string | null>(null);
const testEventId = `aurora-acceptance-${crypto.randomUUID()}`;
let pollDeadline = 0;
let pollTimer: ReturnType<typeof setTimeout> | undefined;

const installCommand = computed(() => {
  const packages = '@aurora/browser @aurora/plugin-error';
  if (packageManager.value === 'pnpm') return `pnpm add ${packages}`;
  if (packageManager.value === 'yarn') return `yarn add ${packages}`;
  return `npm install ${packages}`;
});

const initializationCode = computed(
  () => `import {
  createAuroraSdk,
  createBrowserEnvironment
} from "@aurora/browser";
import { createErrorCapturePlugin } from "@aurora/plugin-error";

const browser = createBrowserEnvironment();
const aurora = createAuroraSdk({
  config: {
    clientKey: ${JSON.stringify(clientKey ?? '请从“客户端密钥”页面新建密钥')},
    environment: ${JSON.stringify(environment)}
  },
  environment: browser,
  plugins: [createErrorCapturePlugin(browser)],
  ingestEndpoint: "https://ingest.aurora.ah.cn"
});

await aurora.start();`,
);

const testErrorCode = `setTimeout(() => {
  throw new Error(${JSON.stringify(TEST_ERROR_TITLE)});
}, 0);`;

const diagnosis = ref<DiagnosisData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    diagnosis.value = await fetchDataStatus({ organizationId, projectId });
  } catch (caught) {
    diagnosis.value = null;
    error.value = describeRequestError(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

const summaryView = computed(() =>
  toSectionView({
    loading: loading.value,
    error: error.value,
    section: diagnosis.value?.summary ?? null,
  }),
);
const stagesView = computed(() =>
  toSectionView<StageFacts>({
    loading: loading.value,
    error: error.value,
    section: diagnosis.value?.stages ?? null,
  }),
);
const credentialView = computed(() =>
  toSectionView({
    loading: loading.value,
    error: error.value,
    section: diagnosis.value?.credential ?? null,
  }),
);
const queryableView = computed(() =>
  toSectionView({
    loading: loading.value,
    error: error.value,
    section: diagnosis.value?.queryable ?? null,
  }),
);

const statusLine = computed(() => {
  if (summaryView.value.kind === 'available') return onboardingStatusLine(summaryView.value.data);
  return null;
});

const actionTargets = computed(() => {
  const targets = diagnosis.value?.actionTargets ?? [];
  return targets
    .map((target) => ({ target, href: actionTargetHref(target) }))
    .filter(
      (entry): entry is { target: (typeof targets)[number]; href: string } => entry.href !== null,
    );
});

function onRecheck(): void {
  void startChecking();
}

function issueHref(issueId: string): string {
  return (
    resolveRouteTarget({
      routeId: 'project.issue-detail',
      pathParams: { organizationId, projectId, issueId },
      query: {},
    }).path ?? '/not-found'
  );
}

async function checkForConnectedIssue(): Promise<boolean> {
  invalidateScope({ type: 'project', id: projectId });
  await load();
  const issues = await fetchIssueList(
    { organizationId, projectId },
    { timeRange: defaultTimeRange(), limit: 100 },
  );
  const issue = issues.issues.items.find((candidate) => candidate.title === TEST_ERROR_TITLE);
  if (issue === undefined) return false;
  testIssueId.value = issue.issueId;
  checkState.value = 'connected';
  return true;
}

async function pollOnce(): Promise<void> {
  try {
    if (await checkForConnectedIssue()) return;
  } catch (caught) {
    error.value = describeRequestError(caught);
  }
  if (Date.now() >= pollDeadline) {
    checkState.value = 'timeout';
    return;
  }
  pollTimer = setTimeout(() => void pollOnce(), POLL_INTERVAL_MS);
}

async function startChecking(): Promise<void> {
  if (checkState.value === 'checking') return;
  if (pollTimer !== undefined) clearTimeout(pollTimer);
  checkState.value = 'checking';
  pollDeadline = Date.now() + POLL_LIMIT_MS;
  await pollOnce();
}

async function sendTestError(): Promise<void> {
  if (clientKey === null || sendState.value === 'sending' || sendState.value === 'accepted') return;
  sendState.value = 'sending';
  sendError.value = null;
  const occurredAt = Date.now();
  try {
    const response = await fetch('https://ingest.aurora.ah.cn/v1/batches', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': clientKey,
        'x-aurora-environment': environment,
      },
      body: JSON.stringify({
        protocolVersion: 1,
        events: [
          {
            protocolVersion: 1,
            eventId: testEventId,
            eventType: 'error',
            occurredAt,
            body: {
              category: 'javascript',
              error: {
                name: 'Error',
                message: TEST_ERROR_TITLE,
                stack: `Error: ${TEST_ERROR_TITLE}\n    at aurora-onboarding-test:1:1`,
              },
            },
          },
        ],
      }),
    });
    const receipt = (await response.json()) as {
      perEventResults?: readonly { eventId?: string; state?: string }[];
    };
    const eventReceipt = receipt.perEventResults?.find((entry) => entry.eventId === testEventId);
    if (
      !response.ok ||
      (eventReceipt?.state !== 'accepted' && eventReceipt?.state !== 'duplicate_accepted')
    ) {
      throw new Error('test event was not accepted');
    }
    sendState.value = 'accepted';
    await startChecking();
  } catch {
    sendState.value = 'error';
    sendError.value = '测试错误发送失败，请检查 Client Key、Origin 与 ingestion 服务状态后重试。';
  }
}

onBeforeUnmount(() => {
  if (pollTimer !== undefined) clearTimeout(pollTimer);
});
</script>

<template>
  <section class="au-surface" data-testid="project-onboarding-view">
    <AppPageHeader title="项目接入" />

    <div class="mon-status" data-testid="onboarding-status">
      <template v-if="checkState === 'connected'">
        <AppStatusBadge tone="success">接入成功</AppStatusBadge>
        <p class="mon-note">测试错误已处理并聚合为 Issue。</p>
        <AppLink v-if="testIssueId !== null" :to="issueHref(testIssueId)">查看测试 Issue</AppLink>
      </template>
      <template v-else-if="statusLine !== null">
        <AppStatusBadge :tone="statusLine.tone">{{ statusLine.label }}</AppStatusBadge>
        <p v-if="statusLine.note" class="mon-note">{{ statusLine.note }}</p>
      </template>
      <SectionNotice v-else :view="summaryView" />
    </div>

    <section class="mon-block" data-testid="onboarding-stages">
      <h2 class="mon-title">接入阶段事实</h2>
      <template v-if="stagesView.kind !== 'available'">
        <SectionNotice :view="stagesView" />
      </template>
      <dl v-else class="mon-stages">
        <div class="mon-stage">
          <dt>已接收（可靠缓冲）</dt>
          <dd class="mon-count">{{ formatCount(stagesView.data.received.count) }}</dd>
          <dd v-if="stagesView.data.received.latestAt" class="mon-meta">
            {{ formatUtc(stagesView.data.received.latestAt) }}
          </dd>
        </div>
        <div class="mon-stage">
          <dt>处理中（pending/leased/retry）</dt>
          <dd class="mon-count">{{ formatCount(stagesView.data.processing.count) }}</dd>
          <dd v-if="stagesView.data.processing.latestAt" class="mon-meta">
            {{ formatUtc(stagesView.data.processing.latestAt) }}
          </dd>
        </div>
        <div class="mon-stage">
          <dt>已处理（processed）</dt>
          <dd class="mon-count">{{ formatCount(stagesView.data.processed.count) }}</dd>
          <dd v-if="stagesView.data.processed.latestAt" class="mon-meta">
            {{ formatUtc(stagesView.data.processed.latestAt) }}
          </dd>
        </div>
        <div class="mon-stage">
          <dt>死信（dead letter）</dt>
          <dd class="mon-count">{{ formatCount(stagesView.data.deadLetter.count) }}</dd>
          <dd v-if="stagesView.data.deadLetter.lastErrorCode" class="mon-meta">
            最近错误：{{ stagesView.data.deadLetter.lastErrorCode }}
          </dd>
        </div>
      </dl>
      <p class="mon-hint">
        已接收 ≠ 已处理 ≠ 已可查询：只有进入 processing-store 的证据才算可查询。
      </p>
    </section>

    <section class="mon-block" data-testid="onboarding-credential">
      <h2 class="mon-title">上报密钥</h2>
      <template v-if="credentialView.kind !== 'available'">
        <SectionNotice :view="credentialView" />
      </template>
      <dl v-else class="mon-inline">
        <div>
          <dt>激活</dt>
          <dd>{{ formatCount(credentialView.data.activeCount) }}</dd>
        </div>
        <div>
          <dt>停用</dt>
          <dd>{{ formatCount(credentialView.data.disabledCount) }}</dd>
        </div>
        <div>
          <dt>吊销</dt>
          <dd>{{ formatCount(credentialView.data.revokedCount) }}</dd>
        </div>
      </dl>
    </section>

    <section class="mon-block" data-testid="onboarding-queryable">
      <h2 class="mon-title">可查询证据</h2>
      <template v-if="queryableView.kind !== 'available'">
        <SectionNotice :view="queryableView" />
      </template>
      <dl v-else class="mon-inline">
        <div>
          <dt>错误事件</dt>
          <dd>{{ formatCount(queryableView.data.errorOccurrences) }}</dd>
        </div>
        <div>
          <dt>请求指标桶</dt>
          <dd>{{ formatCount(queryableView.data.requestMetricBuckets) }}</dd>
        </div>
        <div>
          <dt>性能指标桶</dt>
          <dd>{{ formatCount(queryableView.data.performanceMetricBuckets) }}</dd>
        </div>
      </dl>
    </section>

    <section v-if="actionTargets.length > 0" class="mon-block" data-testid="onboarding-actions">
      <h2 class="mon-title">下一步</h2>
      <ul class="mon-actions">
        <li v-for="entry in actionTargets" :key="entry.href">
          <AppLink :to="entry.href">{{ entry.target.routeId }}</AppLink>
        </li>
      </ul>
    </section>

    <section class="mon-block mon-guide" data-testid="onboarding-guide">
      <h2 class="mon-title">接入引导</h2>
      <ol class="mon-steps">
        <li>
          <h3>1. 安装 SDK</h3>
          <div class="mon-package-managers" role="group" aria-label="包管理器">
            <button
              v-for="manager in ['npm', 'pnpm', 'yarn'] as const"
              :key="manager"
              type="button"
              class="au-button"
              :aria-pressed="packageManager === manager"
              @click="packageManager = manager"
            >
              {{ manager }}
            </button>
          </div>
          <pre
            class="mon-code"
            data-testid="onboarding-install-command"
          ><code>{{ installCommand }}</code></pre>
        </li>
        <li>
          <h3>2. 初始化 SDK</h3>
          <p class="mon-hint">
            使用当前项目的一次性交付 Client Key 与默认 Production Environment。
          </p>
          <AppStatusBadge v-if="clientKey === null" tone="warning">
            当前页面没有可恢复的完整 Client Key，请在“客户端密钥”页面新建密钥。
          </AppStatusBadge>
          <pre
            class="mon-code"
            data-testid="onboarding-init-code"
          ><code>{{ initializationCode }}</code></pre>
        </li>
        <li>
          <h3>3. 发送测试错误</h3>
          <p class="mon-hint">
            运行下方代码后点击“我已经发送测试事件”。只有事件已处理且 Issues 中出现对应测试 Issue
            时才会显示“接入成功”。
          </p>
          <pre
            class="mon-code"
            data-testid="onboarding-test-code"
          ><code>{{ testErrorCode }}</code></pre>
          <div class="mon-actions-row">
            <AppButton
              variant="primary"
              data-testid="onboarding-send-test"
              :disabled="clientKey === null || sendState === 'sending' || sendState === 'accepted'"
              @click="sendTestError"
            >
              {{
                sendState === 'sending'
                  ? '正在发送…'
                  : sendState === 'accepted'
                    ? '测试错误已接收'
                    : '发送测试错误'
              }}
            </AppButton>
          </div>
          <AppStatusBadge v-if="sendError !== null" tone="danger">{{ sendError }}</AppStatusBadge>
          <AppStatusBadge v-if="checkState === 'checking'" tone="warning">
            正在检查接收、处理与 Issue 聚合（最长 60 秒）…
          </AppStatusBadge>
          <AppStatusBadge v-else-if="checkState === 'timeout'" tone="warning">
            60 秒内尚未确认接入成功，自动检查已停止。
          </AppStatusBadge>
          <div class="mon-actions-row">
            <AppButton
              variant="primary"
              data-testid="onboarding-recheck"
              :disabled="loading || checkState === 'checking' || sendState === 'idle'"
              @click="onRecheck"
            >
              {{ checkState === 'timeout' ? '重新检查' : '我已经发送测试事件' }}
            </AppButton>
          </div>
        </li>
      </ol>
    </section>
  </section>
</template>

<style scoped>
.mon-status {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}
.mon-note {
  margin: 0;
  color: var(--color-text-secondary);
  max-width: 56ch;
}
.mon-block {
  margin-bottom: var(--space-5);
}
.mon-title {
  margin: 0 0 var(--space-2);
  font-size: 16px;
  color: var(--color-text-primary);
}
.mon-stages {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-3);
  margin: 0;
}
.mon-stage {
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  padding: var(--space-3);
}
.mon-stage dt {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-count {
  margin: var(--space-1) 0 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.mon-meta {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-inline {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: 0;
}
.mon-inline dt {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-inline dd {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.mon-hint {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
.mon-actions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.mon-steps {
  margin: 0;
  padding-left: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.mon-steps h3 {
  margin: 0 0 var(--space-1);
  font-size: 14px;
  color: var(--color-text-primary);
}
.mon-code {
  margin: var(--space-2) 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  overflow-x: auto;
  background-color: var(--color-surface-bg);
}
.mon-actions-row {
  margin-top: var(--space-3);
}
.mon-package-managers {
  display: flex;
  gap: var(--space-2);
}
.au-button {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-height);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  cursor: pointer;
  font: inherit;
}
.au-button:hover {
  border-color: var(--color-action-primary);
  color: var(--color-action-primary);
}
.au-button:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
