<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { actionTargetHref, actionTargetLabel, summaryDisplay, type DiagnosisData } from '../../monitoring/diagnosis.js';
import { formatCount, formatUtc } from '../../monitoring/format.js';
import { fetchDataStatus } from '../../monitoring/queries.js';
import AppLink from '../../components/aurora/AppLink.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppSection from '../../components/aurora/AppSection.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import AppTechnicalDetails from '../../components/aurora/AppTechnicalDetails.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';
import { buildDataStatusState, type DataStatusState } from './data-status-view-model.js';

const route = useRoute();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const diagnosis = ref<DiagnosisData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
async function load(): Promise<void> {
  loading.value = true; error.value = null;
  try { diagnosis.value = await fetchDataStatus({ organizationId, projectId }); }
  catch (caught) { diagnosis.value = null; error.value = describeRequestError(caught); }
  finally { loading.value = false; }
}
onMounted(() => { void load(); });
const state = computed<DataStatusState>(() => buildDataStatusState({ loading: loading.value, error: error.value, diagnosis: diagnosis.value }));
const authority = computed(() => state.value.summary.kind === 'available' ? summaryDisplay(state.value.summary.data) : null);
const actionTargets = computed(() => state.value.actions.map((target) => ({ target, href: actionTargetHref(target) })).filter((entry): entry is { target: (typeof state.value.actions)[number]; href: string } => entry.href !== null));
</script>

<template>
  <section class="au-surface mon-workspace" data-testid="project-data-status-view">
    <AppPageHeader title="数据接收诊断" description="按接收、处理与可查询证据逐层核对；各区域可独立不可用。">
      <template #actions><button type="button" class="au-button" :disabled="loading" @click="load">刷新诊断</button></template>
    </AppPageHeader>

    <AppSection title="当前接收状态" description="当前权威状态与原因由服务端组合。" :tone="authority?.tone ?? 'neutral'" test-id="ds-authority">
      <SectionNotice v-if="state.summary.kind !== 'available'" :view="state.summary" />
      <template v-else-if="authority !== null">
        <div class="mon-authority-line"><AppStatusBadge :tone="authority.tone">{{ authority.label }}</AppStatusBadge><p v-if="authority.causeLabel" class="mon-note">原因：{{ authority.causeLabel }}</p></div>
        <p class="mon-meta">服务端组合时刻（UTC）：{{ formatUtc(state.summary.data.asOf) }}</p>
        <AppTechnicalDetails summary="技术详情">状态键: {{ state.summary.data.status }}<template v-if="state.summary.data.primaryCause">\n原因键: {{ state.summary.data.primaryCause }}</template></AppTechnicalDetails>
      </template>
    </AppSection>

    <AppSection title="处理阶段" description="已接收不代表已处理，已处理也不代表已可查询。" test-id="ds-stages">
      <SectionNotice v-if="state.stages.kind !== 'available'" :view="state.stages" />
      <dl v-else class="mon-stage-grid">
        <div data-testid="ds-stage-received"><dt>已接收（可靠缓冲）</dt><dd>{{ formatCount(state.stages.data.received.count) }}</dd><dd v-if="state.stages.data.received.latestAt" class="mon-stage-meta">{{ formatUtc(state.stages.data.received.latestAt) }}</dd></div>
        <div data-testid="ds-stage-processing"><dt>处理中</dt><dd>{{ formatCount(state.stages.data.processing.count) }}</dd><dd v-if="state.stages.data.processing.latestAt" class="mon-stage-meta">{{ formatUtc(state.stages.data.processing.latestAt) }}</dd></div>
        <div data-testid="ds-stage-processed"><dt>已处理</dt><dd>{{ formatCount(state.stages.data.processed.count) }}</dd><dd v-if="state.stages.data.processed.latestAt" class="mon-stage-meta">{{ formatUtc(state.stages.data.processed.latestAt) }}</dd></div>
        <div data-testid="ds-stage-deadletter"><dt>死信事件</dt><dd>{{ formatCount(state.stages.data.deadLetter.count) }}</dd><dd v-if="state.stages.data.deadLetter.lastErrorCode" class="mon-stage-meta">最近错误见技术详情</dd></div>
      </dl>
      <AppTechnicalDetails v-if="state.stages.kind === 'available' && state.stages.data.deadLetter.lastErrorCode" summary="技术详情">最近错误键: {{ state.stages.data.deadLetter.lastErrorCode }}</AppTechnicalDetails>
    </AppSection>

    <section class="mon-evidence-grid" data-testid="ds-trust-evidence" aria-label="数据可信度证据">
      <AppSection title="最近数据" description="最近接收与处理的事实不互相推断。">
        <SectionNotice v-if="state.recent.kind !== 'available'" :view="state.recent" />
        <dl v-else class="mon-inline"><div><dt>最近接收</dt><dd>{{ formatCount(state.recent.data.receivedCount) }}<span v-if="state.recent.data.latestReceivedAt" class="mon-meta"> · {{ formatUtc(state.recent.data.latestReceivedAt) }}</span></dd></div><div><dt>最近已处理</dt><dd>{{ formatCount(state.recent.data.processedCount) }}<span v-if="state.recent.data.latestProcessedAt" class="mon-meta"> · {{ formatUtc(state.recent.data.latestProcessedAt) }}</span></dd></div></dl>
      </AppSection>
      <AppSection title="拒绝批次证据" description="未持久化的拒绝批次不会被重建为确定事实。">
        <SectionNotice v-if="state.rejection.kind !== 'available'" :view="state.rejection" />
        <p v-else class="mon-note">无被拒绝批次证据。</p>
      </AppSection>
      <AppSection title="密钥状态" description="安全投影不显示密钥本身。">
        <SectionNotice v-if="state.credential.kind !== 'available'" :view="state.credential" />
        <dl v-else class="mon-inline"><div><dt>激活</dt><dd>{{ formatCount(state.credential.data.activeCount) }}</dd></div><div><dt>停用</dt><dd>{{ formatCount(state.credential.data.disabledCount) }}</dd></div><div><dt>吊销</dt><dd>{{ formatCount(state.credential.data.revokedCount) }}</dd></div></dl>
      </AppSection>
      <AppSection title="可查询证据" description="只有处理存储中的投影才可查询。">
        <SectionNotice v-if="state.queryable.kind !== 'available'" :view="state.queryable" />
        <dl v-else class="mon-inline"><div><dt>错误事件</dt><dd>{{ formatCount(state.queryable.data.errorOccurrences) }}</dd></div><div><dt>请求指标桶</dt><dd>{{ formatCount(state.queryable.data.requestMetricBuckets) }}</dd></div><div><dt>性能指标桶</dt><dd>{{ formatCount(state.queryable.data.performanceMetricBuckets) }}</dd></div></dl>
      </AppSection>
    </section>

    <AppSection v-if="actionTargets.length > 0" title="可执行行动" description="仅显示当前服务端已授权的目标。" test-id="ds-actions"><ul class="mon-actions"><li v-for="entry in actionTargets" :key="entry.href"><AppLink :to="entry.href">{{ actionTargetLabel(entry.target.routeId) }}</AppLink></li></ul></AppSection>
  </section>
</template>

<style scoped>
.mon-workspace { display: flex; flex-direction: column; gap: var(--space-5); }.mon-authority-line { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }.mon-note { margin: var(--space-2) 0 0; color: var(--color-text-secondary); }.mon-meta, .mon-stage-meta { color: var(--color-text-secondary); font-size: 12px; }.mon-stage-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-3); margin: 0; }.mon-stage-grid > div { padding: var(--space-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-base); }.mon-stage-grid dt, .mon-inline dt { color: var(--color-text-secondary); font-size: 12px; }.mon-stage-grid dd, .mon-inline dd { margin: var(--space-1) 0 0; color: var(--color-text-primary); font-weight: 650; }.mon-stage-grid .mon-stage-meta { display: block; font-weight: 400; }.mon-evidence-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }.mon-inline { display: flex; flex-wrap: wrap; gap: var(--space-4); margin: 0; }.mon-actions { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }.au-button { min-height: var(--control-height); padding: 0 var(--space-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-base); background: var(--color-surface-bg); color: var(--color-text-primary); font: inherit; cursor: pointer; }.au-button:disabled { cursor: default; opacity: .6; } @media (max-width: 900px) { .mon-stage-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } } @media (max-width: 700px) { .mon-evidence-grid, .mon-stage-grid { grid-template-columns: 1fr; } }
</style>
