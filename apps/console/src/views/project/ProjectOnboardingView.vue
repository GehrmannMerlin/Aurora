<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import {
  actionTargetHref,
  actionTargetLabel,
  summaryDisplay,
  type DiagnosisData,
  type StageFacts,
} from '../../monitoring/diagnosis.js';
import { formatCount, formatUtc } from '../../monitoring/format.js';
import { fetchDataStatus } from '../../monitoring/queries.js';
import { toSectionView } from '../../monitoring/section.js';
import AppLink from '../../components/aurora/AppLink.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppSection from '../../components/aurora/AppSection.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import AppTechnicalDetails from '../../components/aurora/AppTechnicalDetails.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';
import { onboardingStatusLine } from './onboarding-view-model.js';

const route = useRoute();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
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
</script>

<template>
  <section class="au-surface mon-workspace" data-testid="project-onboarding-view">
    <AppPageHeader title="项目接入" description="按顺序建立接入，再从服务端证据确认各阶段。">
      <template #actions><button type="button" class="au-button" :disabled="loading" data-testid="onboarding-recheck" @click="load">重新检查接入链</button></template>
    </AppPageHeader>

    <AppSection title="当前接入证据" description="服务端诊断不等同于测试事件已生成问题。" :tone="statusLine?.tone ?? 'neutral'" test-id="onboarding-status">
      <SectionNotice v-if="summaryView.kind !== 'available'" :view="summaryView" />
      <template v-else-if="statusLine !== null && authority !== null">
        <AppStatusBadge :tone="statusLine.tone">{{ statusLine.label }}</AppStatusBadge>
        <p v-if="authority.causeLabel" class="mon-note">原因：{{ authority.causeLabel }}</p>
        <p v-if="statusLine.note" class="mon-note">{{ statusLine.note }}</p>
        <p class="mon-meta">服务端组合时刻（UTC）：{{ formatUtc(summaryView.data.asOf) }}</p>
        <AppTechnicalDetails summary="技术详情">状态键: {{ summaryView.data.status }}<template v-if="summaryView.data.primaryCause">\n原因键: {{ summaryView.data.primaryCause }}</template></AppTechnicalDetails>
      </template>
    </AppSection>

    <AppSection title="接入步骤" description="三步均保留原有能力边界；未提供的项目数据不会由页面补造。" test-id="onboarding-guide">
      <ol class="mon-onboarding-sequence">
        <li><span class="mon-step-number">1</span><div><h3>安装 SDK</h3><p>安装命令需由版本化模板契约提供；当前能力未提供，因此不会生成猜测的版本命令。</p></div></li>
        <li><span class="mon-step-number">2</span><div><h3>初始化 SDK</h3><p>初始化使用当前项目的客户端上报密钥与运行环境。真实密钥投影尚未提供，以下仅为批准的结构示例。</p><pre class="mon-code"><code>import {{ '{' }} Aurora {{ '}' }} from "@aurora/browser";

Aurora.init({{ '{' }}
  clientKey: "（未提供：密钥投影能力尚未开放）",
  environment: "production"
{{ '}' }});</code></pre></div></li>
        <li><span class="mon-step-number">3</span><div><h3>发送测试错误</h3><p>测试错误需完成接收、校验、存储并聚合为问题；测试事件状态查询未提供，页面不会宣称接入成功。</p><pre class="mon-code"><code>import {{ '{' }} Aurora {{ '}' }} from "@aurora/browser";

Aurora.captureException(
  new Error("Aurora SDK 接入测试")
);</code></pre><AppStatusBadge tone="warning">测试事件状态能力未提供</AppStatusBadge></div></li>
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
.mon-code { margin: var(--space-3) 0; padding: var(--space-3); overflow-x: auto; border: 1px solid var(--color-border-default); border-radius: var(--radius-base); background: var(--color-page-bg); font-family: var(--font-family-mono); font-size: 13px; }
.mon-evidence-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.mon-stage-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); margin: 0; }.mon-stage-grid > div { padding: var(--space-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-base); }.mon-stage-grid dt, .mon-inline dt { color: var(--color-text-secondary); font-size: 12px; }.mon-stage-grid dd, .mon-inline dd { margin: var(--space-1) 0 0; color: var(--color-text-primary); font-weight: 650; }.mon-stage-grid .mon-stage-meta { display: block; font-weight: 400; }
.mon-evidence-stack { display: flex; flex-direction: column; gap: var(--space-4); }.mon-evidence-stack h3 { margin: 0 0 var(--space-2); font-size: 14px; }.mon-inline { display: flex; flex-wrap: wrap; gap: var(--space-4); margin: 0; }.mon-actions { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.au-button { min-height: var(--control-height); padding: 0 var(--space-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-base); background: var(--color-surface-bg); color: var(--color-text-primary); font: inherit; cursor: pointer; }.au-button:disabled { cursor: default; opacity: .6; }
@media (max-width: 700px) { .mon-evidence-grid, .mon-stage-grid { grid-template-columns: 1fr; } }
</style>
