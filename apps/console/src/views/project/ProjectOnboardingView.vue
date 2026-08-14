<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { invalidateScope } from '../../api/query.js';
import {
  actionTargetHref,
  actionTargetLabel,
  summaryDisplay,
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
import AppSection from '../../components/aurora/AppSection.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import AppTechnicalDetails from '../../components/aurora/AppTechnicalDetails.vue';
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
  () => `import { createAuroraSdk, createBrowserEnvironment } from "@aurora/browser";
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
  try { diagnosis.value = await fetchDataStatus({ organizationId, projectId }); }
  catch (caught) { diagnosis.value = null; error.value = describeRequestError(caught); }
  finally { loading.value = false; }
}
onMounted(() => { void load(); });

const summaryView = computed(() => toSectionView({ loading: loading.value, error: error.value, section: diagnosis.value?.summary ?? null }));
const stagesView = computed(() => toSectionView<StageFacts>({ loading: loading.value, error: error.value, section: diagnosis.value?.stages ?? null }));
const credentialView = computed(() => toSectionView({ loading: loading.value, error: error.value, section: diagnosis.value?.credential ?? null }));
const queryableView = computed(() => toSectionView({ loading: loading.value, error: error.value, section: diagnosis.value?.queryable ?? null }));
const statusLine = computed(() => summaryView.value.kind === 'available' ? onboardingStatusLine(summaryView.value.data) : null);
const authority = computed(() => summaryView.value.kind === 'available' ? summaryDisplay(summaryView.value.data) : null);
const actionTargets = computed(() => {
  const targets = diagnosis.value?.actionTargets ?? [];
  return targets.map((target) => ({ target, href: actionTargetHref(target) })).filter((entry): entry is { target: (typeof targets)[number]; href: string } => entry.href !== null);
});

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
  <section class="au-surface mon-workspace" data-testid="project-onboarding-view">
    <AppPageHeader title="项目接入" description="按顺序建立接入，再从服务端证据确认各阶段。">
      <template #actions>
        <AppButton
          variant="secondary"
          :disabled="loading || checkState === 'checking'"
          data-testid="onboarding-recheck"
          @click="startChecking"
        >
          {{ checkState === 'timeout' ? '重新检查' : '重新检查接入链' }}
        </AppButton>
      </template>
    </AppPageHeader>

    <AppSection title="当前接入证据" description="服务端诊断不等同于测试事件已生成问题。" :tone="statusLine?.tone ?? 'neutral'" test-id="onboarding-status">
      <template v-if="checkState === 'connected'">
        <AppStatusBadge tone="success">接入成功</AppStatusBadge>
        <p class="mon-note">测试错误已处理并聚合为 Issue。</p>
        <AppLink v-if="testIssueId !== null" :to="issueHref(testIssueId)">查看测试 Issue</AppLink>
      </template>
      <SectionNotice v-else-if="summaryView.kind !== 'available'" :view="summaryView" />
      <template v-else-if="statusLine !== null && authority !== null">
        <AppStatusBadge :tone="statusLine.tone">{{ statusLine.label }}</AppStatusBadge>
        <p v-if="authority.causeLabel" class="mon-note">原因：{{ authority.causeLabel }}</p>
        <p v-if="statusLine.note" class="mon-note">{{ statusLine.note }}</p>
        <p class="mon-meta">服务端组合时刻（UTC）：{{ formatUtc(summaryView.data.asOf) }}</p>
        <AppTechnicalDetails summary="技术详情">状态键: {{ summaryView.data.status }}<template v-if="summaryView.data.primaryCause">\n原因键: {{ summaryView.data.primaryCause }}</template></AppTechnicalDetails>
      </template>
    </AppSection>

    <AppSection title="接入步骤" description="使用一次性交付密钥完成 SDK 初始化，再以服务端证据确认测试错误已形成 Issue。" test-id="onboarding-guide">
      <ol class="mon-onboarding-sequence">
        <li>
          <span class="mon-step-number">1</span>
          <div>
            <h3>安装 SDK</h3>
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
            <pre class="mon-code" data-testid="onboarding-install-command" tabindex="0"><code>{{ installCommand }}</code></pre>
          </div>
        </li>
        <li>
          <span class="mon-step-number">2</span>
          <div>
            <h3>初始化 SDK</h3>
            <p>使用当前项目的一次性交付 Client Key 与默认运行环境。</p>
            <AppStatusBadge v-if="clientKey === null" tone="warning">
              当前页面没有可恢复的完整 Client Key，请在“客户端密钥”页面新建密钥。
            </AppStatusBadge>
            <pre class="mon-code" data-testid="onboarding-init-code" tabindex="0" aria-label="初始化 SDK 示例"><code>{{ initializationCode }}</code></pre>
          </div>
        </li>
        <li>
          <span class="mon-step-number">3</span>
          <div>
            <h3>发送测试错误</h3>
            <p>运行示例或使用下方按钮发送测试错误；只有事件已处理并在 Issues 中形成对应记录时才显示“接入成功”。</p>
            <pre class="mon-code" data-testid="onboarding-test-code" tabindex="0"><code>{{ testErrorCode }}</code></pre>
            <div class="mon-actions-row">
              <AppButton
                variant="primary"
                data-testid="onboarding-send-test"
                :disabled="clientKey === null || sendState === 'sending' || sendState === 'accepted'"
                @click="sendTestError"
              >
                {{ sendState === 'sending' ? '正在发送…' : sendState === 'accepted' ? '测试错误已接收' : '发送测试错误' }}
              </AppButton>
            </div>
            <AppStatusBadge v-if="sendError !== null" tone="danger">{{ sendError }}</AppStatusBadge>
            <AppStatusBadge v-if="checkState === 'checking'" tone="warning">正在检查接收、处理与 Issue 聚合（最长 60 秒）…</AppStatusBadge>
            <AppStatusBadge v-else-if="checkState === 'timeout'" tone="warning">60 秒内尚未确认接入成功，自动检查已停止。</AppStatusBadge>
          </div>
        </li>
      </ol>
    </AppSection>

    <section class="mon-evidence-grid" aria-label="接入证据">
      <AppSection title="处理阶段" description="已接收、处理中、已处理与可查询不能互相替代。" test-id="onboarding-stages">
        <SectionNotice v-if="stagesView.kind !== 'available'" :view="stagesView" />
        <dl v-else class="mon-stage-grid">
          <div><dt>已接收（可靠缓冲）</dt><dd>{{ formatCount(stagesView.data.received.count) }}</dd><dd v-if="stagesView.data.received.latestAt" class="mon-stage-meta">{{ formatUtc(stagesView.data.received.latestAt) }}</dd></div>
          <div><dt>处理中</dt><dd>{{ formatCount(stagesView.data.processing.count) }}</dd><dd v-if="stagesView.data.processing.latestAt" class="mon-stage-meta">{{ formatUtc(stagesView.data.processing.latestAt) }}</dd></div>
          <div><dt>已处理</dt><dd>{{ formatCount(stagesView.data.processed.count) }}</dd><dd v-if="stagesView.data.processed.latestAt" class="mon-stage-meta">{{ formatUtc(stagesView.data.processed.latestAt) }}</dd></div>
          <div><dt>死信事件</dt><dd>{{ formatCount(stagesView.data.deadLetter.count) }}</dd><dd v-if="stagesView.data.deadLetter.lastErrorCode" class="mon-stage-meta">最近错误见技术详情</dd></div>
        </dl>
        <AppTechnicalDetails v-if="stagesView.kind === 'available' && stagesView.data.deadLetter.lastErrorCode" summary="技术详情">最近错误键: {{ stagesView.data.deadLetter.lastErrorCode }}</AppTechnicalDetails>
      </AppSection>
      <AppSection title="密钥与可查询证据" description="密钥状态与已处理的查询证据分别来自服务端投影。">
        <div class="mon-evidence-stack"><div data-testid="onboarding-credential"><h3>上报密钥</h3><SectionNotice v-if="credentialView.kind !== 'available'" :view="credentialView" /><dl v-else class="mon-inline"><div><dt>激活</dt><dd>{{ formatCount(credentialView.data.activeCount) }}</dd></div><div><dt>停用</dt><dd>{{ formatCount(credentialView.data.disabledCount) }}</dd></div><div><dt>吊销</dt><dd>{{ formatCount(credentialView.data.revokedCount) }}</dd></div></dl></div><div data-testid="onboarding-queryable"><h3>可查询证据</h3><SectionNotice v-if="queryableView.kind !== 'available'" :view="queryableView" /><dl v-else class="mon-inline"><div><dt>错误事件</dt><dd>{{ formatCount(queryableView.data.errorOccurrences) }}</dd></div><div><dt>请求指标桶</dt><dd>{{ formatCount(queryableView.data.requestMetricBuckets) }}</dd></div><div><dt>性能指标桶</dt><dd>{{ formatCount(queryableView.data.performanceMetricBuckets) }}</dd></div></dl></div></div>
      </AppSection>
    </section>

    <AppSection v-if="actionTargets.length > 0" title="可执行行动" description="仅显示服务端已授权的目标。" test-id="onboarding-actions"><ul class="mon-actions"><li v-for="entry in actionTargets" :key="entry.href"><AppLink :to="entry.href">{{ actionTargetLabel(entry.target.routeId) }}</AppLink></li></ul></AppSection>
  </section>
</template>

<style scoped>
.mon-workspace { display: flex; flex-direction: column; gap: var(--space-5); }
.mon-note { margin: var(--space-2) 0 0; color: var(--color-text-secondary); }
.mon-meta, .mon-stage-meta { color: var(--color-text-secondary); font-size: 12px; }
.mon-onboarding-sequence { display: flex; flex-direction: column; gap: var(--space-4); margin: 0; padding: 0; list-style: none; }
.mon-onboarding-sequence li { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: var(--space-3); }
.mon-onboarding-sequence h3 { margin: 0; font-size: 15px; }.mon-onboarding-sequence p { margin: var(--space-2) 0 0; color: var(--color-text-secondary); max-width: 64ch; }
.mon-step-number { display: grid; width: 28px; height: 28px; place-items: center; border: 1px solid var(--color-border-default); border-radius: 50%; color: var(--color-action-primary); font-weight: 700; }
.mon-code { margin: var(--space-3) 0; padding: var(--space-3); overflow-x: auto; border: 1px solid var(--color-border-default); border-radius: var(--radius-control); background: var(--color-page-bg); font-family: var(--font-family-mono); font-size: 13px; }
.mon-package-managers, .mon-actions-row { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
.mon-evidence-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.mon-stage-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); margin: 0; }.mon-stage-grid > div { padding: var(--space-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-control); }.mon-stage-grid dt, .mon-inline dt { color: var(--color-text-secondary); font-size: 12px; }.mon-stage-grid dd, .mon-inline dd { margin: var(--space-1) 0 0; color: var(--color-text-primary); font-weight: 650; }.mon-stage-grid .mon-stage-meta { display: block; font-weight: 400; }
.mon-evidence-stack { display: flex; flex-direction: column; gap: var(--space-4); }.mon-evidence-stack h3 { margin: 0 0 var(--space-2); font-size: 14px; }.mon-inline { display: flex; flex-wrap: wrap; gap: var(--space-4); margin: 0; }.mon-actions { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.au-button { min-height: var(--control-height); padding: 0 var(--space-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-control); background: var(--color-surface-bg); color: var(--color-text-primary); font: inherit; cursor: pointer; }.au-button:disabled { cursor: default; opacity: .6; }
@media (max-width: 700px) { .mon-evidence-grid, .mon-stage-grid { grid-template-columns: 1fr; } }
</style>
