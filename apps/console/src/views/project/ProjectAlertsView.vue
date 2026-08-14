<script setup lang="ts">
/**
 * C10 告警规则/实例双标签页（`project.alerts`，PLT-07）。
 *
 * 只消费 `alertsListRulesAndInstances`（DAT-19）。`tab=rules|instances` 为 URL
 * 权威状态（默认 instances）；规则当前评估投影与实例生命周期分开渲染；
 * `evaluation_paused` 显示暂停原因而非恢复。新建/编辑入口前端不隐藏，每次
 * Command 由服务端按 project_admin 重鉴权（403 就地显示）。
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { formatUtc } from '../../monitoring/format.js';
import { fetchAlertsList, type AlertsData } from '../../monitoring/queries.js';
import { resolveRouteTarget } from '../../contracts/route-registry.js';
import { buildAlertsView, instanceStateLabel, ruleStateLabel } from './alerts-view-model.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppLink from '../../components/aurora/AppLink.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import AppTechnicalDetails from '../../components/aurora/AppTechnicalDetails.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';

const route = useRoute();
const router = useRouter();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const scope = { organizationId, projectId };

const tab = computed<'rules' | 'instances'>(() => {
  const raw = route.query.tab;
  return raw === 'rules' ? 'rules' : 'instances';
});

const data = ref<AlertsData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const instancesTab = ref<HTMLButtonElement | null>(null);
const rulesTab = ref<HTMLButtonElement | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    data.value = await fetchAlertsList(scope);
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
  buildAlertsView({
    loading: loading.value,
    error: error.value,
    rules: data.value?.rules ?? null,
    instances: data.value?.instances ?? null,
  }),
);

async function setTab(next: 'rules' | 'instances', moveFocus = false): Promise<void> {
  if (next !== tab.value) {
    await router.push({ query: { ...route.query, tab: next } });
  }
  if (!moveFocus) return;
  await nextTick();
  (next === 'instances' ? instancesTab.value : rulesTab.value)?.focus();
}

function onTabKeydown(event: KeyboardEvent, current: 'rules' | 'instances'): void {
  const next =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? current === 'instances'
        ? 'rules'
        : 'instances'
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? current === 'instances'
          ? 'rules'
          : 'instances'
        : event.key === 'Home'
          ? 'instances'
          : event.key === 'End'
            ? 'rules'
            : null;
  if (next === null) return;
  event.preventDefault();
  void setTab(next, true);
}

function readableRuleName(name: string | undefined): string {
  return name?.trim() || '未命名告警规则';
}

const alertReasonLabels: Readonly<Record<string, string>> = Object.freeze({
  triggered: '观测值满足触发条件',
  recovered: '观测值满足恢复条件',
  evaluation_paused: '评估已暂停',
  evaluation_resumed: '评估已恢复',
});

function alertReasonLabel(reason: string): string {
  return alertReasonLabels[reason] ?? '服务端未提供可读说明';
}

function createRuleHref(): string {
  const resolved = resolveRouteTarget({
    routeId: 'project.alert-rule-create',
    pathParams: { organizationId, projectId },
    query: {},
  });
  return resolved.path ?? '/not-found';
}

function editRuleHref(ruleId: string): string {
  const resolved = resolveRouteTarget({
    routeId: 'project.alert-rule-edit',
    pathParams: { organizationId, projectId, ruleId },
    query: {},
  });
  return resolved.path ?? '/not-found';
}

function instanceHref(instanceId: string): string {
  const resolved = resolveRouteTarget({
    routeId: 'project.alert-instance-detail',
    pathParams: { organizationId, projectId, instanceId },
    query: {},
  });
  return resolved.path ?? '/not-found';
}

function ruleTone(stateName: string): 'neutral' | 'warning' | 'danger' {
  if (stateName === 'triggered') return 'danger';
  if (stateName === 'pending_trigger' || stateName === 'pending_recovery') return 'warning';
  if (stateName === 'evaluation_paused') return 'warning';
  return 'neutral';
}

function instanceTone(stateName: string): 'neutral' | 'warning' | 'danger' {
  if (stateName === 'triggered') return 'danger';
  if (stateName === 'pending_recovery') return 'warning';
  if (stateName === 'evaluation_paused') return 'warning';
  return 'neutral';
}
</script>

<template>
  <section class="au-surface" data-testid="project-alerts-view">
    <AppPageHeader title="告警" />

    <nav class="mon-tabs" role="tablist" aria-label="告警标签">
      <button
        type="button"
        role="tab"
        id="tab-instances"
        ref="instancesTab"
        :aria-selected="tab === 'instances'"
        aria-controls="alert-instances-panel"
        :tabindex="tab === 'instances' ? 0 : -1"
        :class="{ 'is-active': tab === 'instances' }"
        data-testid="tab-instances"
        @click="setTab('instances')"
        @keydown="onTabKeydown($event, 'instances')"
      >
        告警实例
      </button>
      <button
        type="button"
        role="tab"
        id="tab-rules"
        ref="rulesTab"
        :aria-selected="tab === 'rules'"
        aria-controls="alert-rules-panel"
        :tabindex="tab === 'rules' ? 0 : -1"
        :class="{ 'is-active': tab === 'rules' }"
        data-testid="tab-rules"
        @click="setTab('rules')"
        @keydown="onTabKeydown($event, 'rules')"
      >
        告警规则
      </button>
    </nav>

    <template v-if="tab === 'instances'">
      <section
        id="alert-instances-panel"
        class="mon-block"
        role="tabpanel"
        aria-labelledby="tab-instances"
        data-testid="alert-instances"
      >
        <div class="alert-toolbar" data-testid="alert-instances-toolbar">
          <p class="mon-hint">按当前状态、指标和触发时间查看告警实例。</p>
        </div>
        <template v-if="state.instances.kind === 'loading'">
          <p class="mon-hint" role="status">正在加载告警实例…</p>
        </template>
        <template v-else-if="state.instances.kind !== 'available'">
          <SectionNotice :view="state.instances" />
        </template>
        <template v-else>
          <ul v-if="state.instances.data.length > 0" class="mon-list">
            <li
              v-for="instance in state.instances.data"
              :key="instance.instanceId"
              class="mon-list-item"
            >
              <AppLink :to="instanceHref(instance.instanceId)" class="mon-link">
                {{ readableRuleName(instance.ruleName) }}
              </AppLink>
              <div class="mon-meta-row">
                <AppStatusBadge :tone="instanceTone(instance.state)">
                  {{ instanceStateLabel(instance.state) }}
                </AppStatusBadge>
                <span>{{ instance.metric }}</span>
                <span>触发 {{ formatUtc(instance.triggeredAt) }}</span>
                <span v-if="instance.recoveredAt !== undefined"
                  >恢复 {{ formatUtc(instance.recoveredAt) }}</span
                >
                <span v-if="instance.pauseReason !== undefined">{{ alertReasonLabel(instance.pauseReason) }}</span>
              </div>
              <AppTechnicalDetails summary="实例技术详情">
                instanceId: {{ instance.instanceId }}
                ruleId: {{ instance.ruleId }}
              </AppTechnicalDetails>
            </li>
          </ul>
          <p v-else class="mon-hint">尚无告警实例。实例由告警规则触发时创建。</p>
        </template>
      </section>
    </template>

    <template v-else>
      <section
        id="alert-rules-panel"
        class="mon-block"
        role="tabpanel"
        aria-labelledby="tab-rules"
        data-testid="alert-rules"
      >
        <div class="alert-toolbar" data-testid="alert-rules-toolbar">
          <p class="mon-hint">规则配置与当前评估状态分开呈现。</p>
          <AppLink :to="createRuleHref()" class="au-button" data-testid="alert-rule-create-link">
            新建规则
          </AppLink>
        </div>
        <template v-if="state.rules.kind === 'loading'">
          <p class="mon-hint" role="status">正在加载告警规则…</p>
        </template>
        <template v-else-if="state.rules.kind !== 'available'">
          <SectionNotice :view="state.rules" />
        </template>
        <template v-else>
          <ul v-if="state.rules.data.length > 0" class="mon-list">
            <li v-for="rule in state.rules.data" :key="rule.ruleId" class="mon-list-item">
              <div class="mon-title-row">
                <span class="mon-rule-name">{{ readableRuleName(rule.name) }}</span>
                <AppStatusBadge :tone="ruleTone(rule.evaluation.state)">
                  {{ ruleStateLabel(rule.evaluation.state) }}
                </AppStatusBadge>
                <AppLink :to="editRuleHref(rule.ruleId)" class="mon-edit-link">编辑</AppLink>
              </div>
              <div class="mon-meta">
                指标 {{ rule.metric }} · 窗口 {{ rule.windowMinutes }} 分钟 · 触发
                {{ rule.triggerThreshold }} · 恢复 {{ rule.recoveryThreshold }}
                <template v-if="rule.evaluation.observedValue !== undefined">
                  · 观测 {{ rule.evaluation.observedValue }}
                </template>
                <template v-if="rule.evaluation.pauseReason !== undefined">
                  · {{ alertReasonLabel(rule.evaluation.pauseReason) }}
                </template>
                <template v-if="rule.evaluation.lastEvaluatedAt !== undefined">
                  · 评估 {{ formatUtc(rule.evaluation.lastEvaluatedAt) }}
                </template>
              </div>
              <AppTechnicalDetails summary="规则技术详情">
                ruleId: {{ rule.ruleId }}
                version: {{ rule.version }}
              </AppTechnicalDetails>
            </li>
          </ul>
          <p v-else class="mon-hint">尚无告警规则。创建规则以监控指标超阈值。</p>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
.mon-tabs {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--color-border-default);
  margin-bottom: var(--space-4);
}
.mon-tabs button {
  padding: var(--space-2) var(--space-3);
  border: none;
  background: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  font: inherit;
  border-bottom: 2px solid transparent;
}
.mon-tabs button.is-active {
  color: var(--color-text-primary);
  border-bottom-color: var(--color-action-primary);
}
.mon-block {
  margin-bottom: var(--space-5);
}
.mon-hint {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
.mon-meta,
.mon-meta-row {
  color: var(--color-text-secondary);
  font-size: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}
.mon-list {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.mon-list-item {
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  padding: var(--space-3);
}
.mon-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.mon-rule-name {
  font-weight: 600;
  font-size: 15px;
  color: var(--color-text-primary);
}
.mon-link {
  color: var(--color-action-primary);
  text-decoration: none;
  font-weight: 600;
}
.mon-edit-link {
  color: var(--color-action-primary);
  font-size: 12px;
  text-decoration: none;
  margin-left: auto;
}
.mon-actions-row {
  margin-bottom: var(--space-2);
}

.alert-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.alert-toolbar .mon-hint { margin: 0; }
@media (max-width: 640px) {
  .alert-toolbar { align-items: flex-start; flex-direction: column; }
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
  text-decoration: none;
}
.au-button:hover {
  border-color: var(--color-action-primary);
  color: var(--color-action-primary);
}
</style>
