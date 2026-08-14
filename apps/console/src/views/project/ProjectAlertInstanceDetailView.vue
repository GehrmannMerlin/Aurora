<script setup lang="ts">
/**
 * C12 告警实例详情（`project.alert-instance-detail`，PLT-07）。
 *
 * 只读。只消费 `alertsGetInstanceDetail`（DAT-19）：当前状态/直接原因、规则快照
 * （与当前规则分离）、评估证据、有序业务状态轨迹。`evaluation_paused` 显示暂停
 * 而非恢复；`completeness: insufficient|missing` 明确数据不足。无任何操作按钮。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { formatUtc } from '../../monitoring/format.js';
import {
  fetchAlertInstanceDetail,
  type AlertInstanceDetailData,
} from '../../monitoring/queries.js';
import {
  buildAlertInstanceDetailView,
  completenessLabel,
  instanceStateLabel,
} from './alert-instance-detail-view-model.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppLink from '../../components/aurora/AppLink.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';

const route = useRoute();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const instanceId = String(route.params.instanceId ?? '');
const scope = { organizationId, projectId };

const detail = ref<AlertInstanceDetailData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    detail.value = await fetchAlertInstanceDetail(scope, instanceId);
  } catch (caught) {
    error.value = describeRequestError(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

const state = computed(() =>
  buildAlertInstanceDetailView({
    loading: loading.value,
    error: error.value,
    detail: detail.value,
  }),
);

function instanceTone(stateName: string): 'neutral' | 'warning' | 'danger' {
  if (stateName === 'triggered') return 'danger';
  if (stateName === 'pending_recovery') return 'warning';
  if (stateName === 'evaluation_paused') return 'warning';
  return 'neutral';
}

function backHref(): string {
  return `/organizations/${organizationId}/projects/${projectId}/alerts`;
}

function filtersText(filters: {
  readonly environment: readonly string[];
  readonly release: readonly string[];
  readonly pageOrEndpoint: readonly string[];
  readonly errorSeverity: readonly string[];
}): string {
  const parts: string[] = [];
  if (filters.environment.length > 0) parts.push(`环境：${filters.environment.join(', ')}`);
  if (filters.release.length > 0) parts.push(`发布：${filters.release.join(', ')}`);
  if (filters.pageOrEndpoint.length > 0)
    parts.push(`页面/接口：${filters.pageOrEndpoint.join(', ')}`);
  if (filters.errorSeverity.length > 0) parts.push(`严重级别：${filters.errorSeverity.join(', ')}`);
  return parts.length > 0 ? parts.join(' · ') : '未限定范围';
}
</script>

<template>
  <section class="au-surface" data-testid="project-alert-instance-detail-view">
    <AppPageHeader title="告警实例详情" />
    <p class="mon-meta">
      <AppLink :to="backHref()">返回告警</AppLink>
    </p>

    <template v-if="state.instance.kind === 'loading'">
      <p class="mon-hint" role="status">正在加载实例详情…</p>
    </template>
    <template v-else-if="state.instance.kind === 'error'">
      <SectionNotice :view="state.instance" />
    </template>
    <template v-else-if="state.instance.kind !== 'available'">
      <SectionNotice :view="state.instance" />
    </template>
    <template v-else>
      <section class="mon-block" data-testid="alert-instance-status">
        <h2 class="mon-title">当前状态</h2>
        <div class="mon-status-row">
          <AppStatusBadge :tone="instanceTone(state.instance.data.state)">
            {{ instanceStateLabel(state.instance.data.state) }}
          </AppStatusBadge>
          <span class="mon-rule-name">{{
            state.instance.data.ruleName ?? state.instance.data.ruleId
          }}</span>
        </div>
        <dl class="mon-dl">
          <dt>指标</dt>
          <dd>{{ state.instance.data.metric }}</dd>
          <dt>触发时间</dt>
          <dd>{{ formatUtc(state.instance.data.triggeredAt) }}</dd>
          <template v-if="state.instance.data.recoveredAt !== undefined">
            <dt>恢复时间</dt>
            <dd>{{ formatUtc(state.instance.data.recoveredAt) }}</dd>
          </template>
          <template v-if="state.instance.data.pauseReason !== undefined">
            <dt>暂停原因</dt>
            <dd>{{ state.instance.data.pauseReason }}</dd>
          </template>
        </dl>
      </section>

      <section class="mon-block mon-instance-reason" data-testid="alert-instance-reason">
        <h2 class="mon-title">触发原因</h2>
        <p>{{ state.instance.data.directReason }}</p>
      </section>

      <section class="mon-block" data-testid="alert-instance-rule-snapshot">
        <h2 class="mon-title">规则快照（本实例实际采用的配置）</h2>
        <template v-if="state.ruleSnapshot.kind !== 'available'">
          <SectionNotice :view="state.ruleSnapshot" />
        </template>
        <template v-else>
          <dl class="mon-dl">
            <dt>指标</dt>
            <dd>{{ state.ruleSnapshot.data.metric }}</dd>
            <dt>筛选范围</dt>
            <dd>{{ filtersText(state.ruleSnapshot.data.filters) }}</dd>
            <dt>统计窗口</dt>
            <dd>{{ state.ruleSnapshot.data.windowMinutes }} 分钟</dd>
            <dt>触发阈值</dt>
            <dd>{{ state.ruleSnapshot.data.triggerThreshold }}</dd>
            <dt>触发持续时间</dt>
            <dd>
              {{
                state.ruleSnapshot.data.triggerDurationMinutes === 0
                  ? '立即'
                  : `${state.ruleSnapshot.data.triggerDurationMinutes} 分钟`
              }}
            </dd>
            <dt>恢复阈值</dt>
            <dd>{{ state.ruleSnapshot.data.recoveryThreshold }}</dd>
            <dt>最小样本数</dt>
            <dd>{{ state.ruleSnapshot.data.minSampleCount ?? '—' }}</dd>
            <dt>冷却时间</dt>
            <dd>{{ state.ruleSnapshot.data.cooldownMinutes }} 分钟</dd>
          </dl>
        </template>
      </section>

      <section class="mon-block" data-testid="alert-instance-evidence">
        <h2 class="mon-title">评估证据</h2>
        <template v-if="state.evidence.kind !== 'available'">
          <SectionNotice :view="state.evidence" />
        </template>
        <template v-else>
          <dl class="mon-dl">
            <dt>数据完整性</dt>
            <dd>{{ completenessLabel(state.evidence.data.completeness) }}</dd>
            <dt>评估时间</dt>
            <dd>{{ formatUtc(state.evidence.data.evaluatedAt) }}</dd>
            <dt>窗口</dt>
            <dd>
              {{ formatUtc(state.evidence.data.windowStartAt) }} →
              {{ formatUtc(state.evidence.data.windowEndAt) }}
            </dd>
            <template v-if="state.evidence.data.observedValue !== undefined">
              <dt>观测值</dt>
              <dd>{{ state.evidence.data.observedValue }}</dd>
            </template>
            <template
              v-if="
                state.evidence.data.numerator !== undefined &&
                state.evidence.data.denominator !== undefined
              "
            >
              <dt>分子/分母</dt>
              <dd>{{ state.evidence.data.numerator }} / {{ state.evidence.data.denominator }}</dd>
            </template>
            <template v-if="state.evidence.data.sampleCount !== undefined">
              <dt>样本数</dt>
              <dd>{{ state.evidence.data.sampleCount }}</dd>
            </template>
            <template
              v-if="
                state.evidence.data.minSampleRequirement !== undefined &&
                state.evidence.data.minSampleRequirement > 0
              "
            >
              <dt>最小样本要求</dt>
              <dd>{{ state.evidence.data.minSampleRequirement }}</dd>
            </template>
            <template v-if="state.evidence.data.watermarkAt !== undefined">
              <dt>数据水位</dt>
              <dd>{{ formatUtc(state.evidence.data.watermarkAt) }}</dd>
            </template>
            <template v-if="state.evidence.data.pauseReason !== undefined">
              <dt>暂停原因</dt>
              <dd>{{ state.evidence.data.pauseReason }}</dd>
            </template>
            <dt>筛选范围</dt>
            <dd>{{ filtersText(state.evidence.data.appliedFilters) }}</dd>
          </dl>
        </template>
      </section>

      <section class="mon-block" data-testid="alert-instance-transitions">
        <h2 class="mon-title">业务状态轨迹</h2>
        <template v-if="state.transitions.kind !== 'available'">
          <SectionNotice :view="state.transitions" />
        </template>
        <template v-else>
          <ol v-if="state.transitions.data.length > 0" class="mon-transition-list">
            <li
              v-for="(transition, index) in state.transitions.data"
              :key="index"
              class="mon-timeline-item"
            >
              <span class="mon-state"
                >{{ instanceStateLabel(transition.from) }} →
                {{ instanceStateLabel(transition.to) }}</span
              >
              <span class="mon-meta"
                >{{ transition.reason }} · {{ formatUtc(transition.occurredAt) }}</span
              >
            </li>
          </ol>
          <p v-else class="mon-hint">该实例尚无业务状态转移记录。</p>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
.mon-block {
  margin-bottom: var(--space-5);
}
.mon-title {
  margin: 0 0 var(--space-2);
  font-size: 16px;
  color: var(--color-text-primary);
}
.mon-hint {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
.mon-meta {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-status-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.mon-rule-name {
  font-weight: 600;
  font-size: 15px;
  color: var(--color-text-primary);
}
.mon-dl {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-1) var(--space-3);
  max-width: 72ch;
}
.mon-dl dt {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-dl dd {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-primary);
}
.mon-transition-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.mon-instance-reason {
  padding: var(--space-3);
  border-left: 3px solid var(--color-status-info);
  background-color: var(--color-surface-bg);
}
.mon-instance-reason p { margin: 0; color: var(--color-text-primary); }
.mon-timeline-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mon-state {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text-primary);
}
</style>
