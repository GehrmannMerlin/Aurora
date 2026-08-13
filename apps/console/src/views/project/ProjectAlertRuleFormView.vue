<script setup lang="ts">
/**
 * C11 告警规则表单（`project.alert-rule-create` / `project.alert-rule-edit`，PLT-07）。
 *
 * 指标优先自适应：字段/选项/单位/依赖只来自 `alertsGetCapability`（DAT-19）。
 * 编辑模式从 `alertsListRulesAndInstances` 预填 list 返回字段；规则详情契约未
 * 返回触发持续时间/冷却/样本等字段，故页面明确提示保存将以当前表单值为准。
 * 提交用 `alertsCreateRule`/`alertsUpdateRule`，服务端按 project_admin 重鉴权。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { ApiError } from '../../api/errors.js';
import { invalidateScope } from '../../api/query.js';
import { createIdempotencyKey } from '../../api/client.js';
import {
  fetchAlertsCapability,
  fetchAlertsList,
  type AlertCapabilityData,
} from '../../monitoring/queries.js';
import {
  createAlertRule,
  updateAlertRule,
  type AlertFilters,
  type AlertRuleInput,
} from '../../monitoring/commands.js';
import { useSessionStore } from '../../stores/session.js';
import {
  applyMetricDefaults,
  initialDraft,
  metricSwitchConflicts,
  validateLocalDraft,
  type AlertRuleFormDraft,
  type LocalFieldErrors,
} from './alert-rule-form-view-model.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppLink from '../../components/aurora/AppLink.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const ruleId = String(route.params.ruleId ?? '');
const scope = { organizationId, projectId };
const isEdit = ruleId.length > 0;

const capability = ref<AlertCapabilityData | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);

const draft = ref<AlertRuleFormDraft>(initialDraft());
const existingVersion = ref<number | null>(null);
const fieldErrors = ref<LocalFieldErrors>({});
const submitting = ref(false);
const submitError = ref<string | null>(null);
const pendingMetric = ref<string | null>(null);

/** v1 filter dimensions are server-unavailable; the form always submits empty filters. */
const EMPTY_FILTERS: AlertFilters = {
  environment: [],
  release: [],
  pageOrEndpoint: [],
  errorSeverity: [],
};

async function loadCapability(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    capability.value = await fetchAlertsCapability(scope);
  } catch (caught) {
    loadError.value = describeRequestError(caught);
  } finally {
    loading.value = false;
  }
}

async function prefillFromList(): Promise<void> {
  if (!isEdit) return;
  try {
    const data = await fetchAlertsList(scope);
    if (data.rules.status === 'available') {
      const rule = data.rules.data.items.find((candidate) => candidate.ruleId === ruleId);
      if (rule !== undefined && capability.value !== null) {
        existingVersion.value = rule.version;
        draft.value = applyMetricDefaults(
          {
            ...initialDraft(),
            ...(rule.name === undefined ? {} : { name: rule.name }),
            metric: rule.metric,
            windowMinutes: rule.windowMinutes,
            triggerThreshold: rule.triggerThreshold,
            recoveryThreshold: rule.recoveryThreshold,
            recipientAccountIds: rule.recipientAccountIds,
          },
          rule.metric,
          capability.value,
        );
      }
    }
  } catch (caught) {
    loadError.value = describeRequestError(caught);
  }
}

onMounted(async () => {
  await loadCapability();
  await prefillFromList();
});

const selectedCapability = computed(() =>
  capability.value === null
    ? undefined
    : capability.value.metrics.find((candidate) => candidate.metric === draft.value.metric),
);

function onMetricSelect(event: Event): void {
  const nextMetric = (event.target as HTMLSelectElement).value;
  if (capability.value === null) return;
  if (nextMetric === draft.value.metric) return;
  const conflicts = metricSwitchConflicts(draft.value, nextMetric, capability.value);
  if (conflicts.length > 0) {
    pendingMetric.value = nextMetric;
    return;
  }
  draft.value = applyMetricDefaults(draft.value, nextMetric, capability.value);
}

function confirmMetricSwitch(): void {
  if (capability.value === null || pendingMetric.value === null) return;
  const nextMetric = pendingMetric.value;
  // Rebuild the draft without minSampleCount (switch away from a ratio metric).
  const cleared: AlertRuleFormDraft = {
    ...(draft.value.name === undefined ? {} : { name: draft.value.name }),
    metric: draft.value.metric,
    windowMinutes: draft.value.windowMinutes,
    triggerThreshold: draft.value.triggerThreshold,
    triggerDurationMinutes: draft.value.triggerDurationMinutes,
    recoveryThreshold: draft.value.recoveryThreshold,
    ...(draft.value.recoveryDurationMinutes === undefined
      ? {}
      : { recoveryDurationMinutes: draft.value.recoveryDurationMinutes }),
    cooldownMinutes: draft.value.cooldownMinutes,
    recipientAccountIds: draft.value.recipientAccountIds,
  };
  draft.value = applyMetricDefaults(cleared, nextMetric, capability.value);
  pendingMetric.value = null;
}

function cancelMetricSwitch(): void {
  pendingMetric.value = null;
}

function onRecipientToggle(accountId: string, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked;
  const current = draft.value.recipientAccountIds;
  draft.value = {
    ...draft.value,
    recipientAccountIds: checked
      ? [...current, accountId]
      : current.filter((candidate) => candidate !== accountId),
  };
}

function patchDraft(patch: Partial<AlertRuleFormDraft>): void {
  draft.value = { ...draft.value, ...patch } as AlertRuleFormDraft;
}

function onNameInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value.trim();
  patchDraft(value === '' ? {} : { name: value });
}

async function submit(): Promise<void> {
  if (capability.value === null || submitting.value) return;
  const errors = validateLocalDraft(draft.value, capability.value);
  fieldErrors.value = errors;
  if (Object.keys(errors).length > 0) {
    submitError.value = '请修正表单中的字段错误。';
    return;
  }
  submitting.value = true;
  submitError.value = null;
  const input: AlertRuleInput = { ...draft.value, filters: EMPTY_FILTERS };
  try {
    if (isEdit) {
      await updateAlertRule(
        scope,
        ruleId,
        input,
        { version: existingVersion.value ?? 1 },
        {
          csrf: session.csrf ?? '',
          idempotencyKey: createIdempotencyKey(),
        },
      );
    } else {
      await createAlertRule(scope, input, {
        csrf: session.csrf ?? '',
        idempotencyKey: createIdempotencyKey(),
      });
    }
    invalidateScope({ type: 'project', id: projectId });
    await router.push({
      path: `/organizations/${organizationId}/projects/${projectId}/alerts`,
      query: { tab: 'rules' },
    });
  } catch (caught) {
    if (caught instanceof ApiError) {
      if (caught.code === 'authorization') submitError.value = '你没有管理该项目告警规则的权限。';
      else if (caught.code === 'version_conflict' || caught.code === 'idempotency_conflict') {
        submitError.value = '规则版本已变化，请返回列表刷新后重试。';
      } else if (caught.code === 'field_validation')
        submitError.value = '规则配置未通过校验，请检查字段。';
      else submitError.value = describeRequestError(caught);
    } else {
      submitError.value = describeRequestError(caught);
    }
  } finally {
    submitting.value = false;
  }
}

function backHref(): string {
  return `/organizations/${organizationId}/projects/${projectId}/alerts?tab=rules`;
}
</script>

<template>
  <section class="au-surface" data-testid="project-alert-rule-form-view">
    <AppPageHeader :title="isEdit ? '编辑告警规则' : '新建告警规则'" />
    <p class="mon-meta">
      <AppLink :to="backHref()">返回告警规则</AppLink>
    </p>

    <template v-if="loadError !== null">
      <SectionNotice :view="{ kind: 'error', message: loadError }" />
    </template>
    <template v-else-if="capability === null">
      <p class="mon-hint" role="status">正在加载告警能力…</p>
    </template>
    <template v-else>
      <p v-if="isEdit" class="mon-hint" data-testid="alert-rule-edit-note">
        规则详情契约未返回触发持续时间/冷却/最小样本等字段，保存将以当前表单值为准。
      </p>

      <form class="mon-form" data-testid="alert-rule-form" @submit.prevent="submit">
        <label class="mon-field">
          指标
          <select :value="draft.metric" data-testid="alert-rule-metric" @change="onMetricSelect">
            <option value="" disabled>请选择指标</option>
            <option
              v-for="metric in capability.metrics"
              :key="metric.metric"
              :value="metric.metric"
            >
              {{ metric.displayName }}
            </option>
          </select>
          <span v-if="fieldErrors.metric" class="mon-error">{{ fieldErrors.metric }}</span>
        </label>

        <template v-if="draft.metric !== ''">
          <p class="mon-hint" data-testid="alert-rule-metric-note">
            {{ selectedCapability?.displayName }} ·
            {{ selectedCapability?.unit === 'percentage' ? '百分比' : '数量' }} · 方向
            {{
              selectedCapability?.direction === 'higher_is_worse'
                ? '越高越异常'
                : selectedCapability?.direction
            }}
            <template v-if="selectedCapability?.isRatio"> · 需要最小样本数</template>
          </p>

          <label class="mon-field">
            统计窗口
            <select
              :value="draft.windowMinutes"
              data-testid="alert-rule-window"
              @change="
                patchDraft({ windowMinutes: Number(($event.target as HTMLSelectElement).value) })
              "
            >
              <option v-for="window in capability.windowsMinutes" :key="window" :value="window">
                最近 {{ window }} 分钟
              </option>
            </select>
            <span v-if="fieldErrors.windowMinutes" class="mon-error">{{
              fieldErrors.windowMinutes
            }}</span>
          </label>

          <label class="mon-field">
            触发阈值
            <input
              type="number"
              min="0"
              :value="draft.triggerThreshold"
              data-testid="alert-rule-trigger-threshold"
              @change="
                patchDraft({ triggerThreshold: Number(($event.target as HTMLInputElement).value) })
              "
            />
          </label>

          <label class="mon-field">
            触发持续时间
            <select
              :value="draft.triggerDurationMinutes"
              data-testid="alert-rule-trigger-duration"
              @change="
                patchDraft({
                  triggerDurationMinutes: Number(($event.target as HTMLSelectElement).value),
                })
              "
            >
              <option
                v-for="duration in capability.triggerDurationsMinutes"
                :key="duration"
                :value="duration"
              >
                {{ duration === 0 ? '立即' : `${duration} 分钟` }}
              </option>
            </select>
            <span v-if="fieldErrors.triggerDurationMinutes" class="mon-error">{{
              fieldErrors.triggerDurationMinutes
            }}</span>
          </label>

          <label class="mon-field">
            恢复阈值
            <input
              type="number"
              min="0"
              :value="draft.recoveryThreshold"
              data-testid="alert-rule-recovery-threshold"
              @change="
                patchDraft({ recoveryThreshold: Number(($event.target as HTMLInputElement).value) })
              "
            />
          </label>

          <label v-if="selectedCapability?.isRatio" class="mon-field">
            最小样本数
            <input
              type="number"
              min="1"
              :value="draft.minSampleCount ?? ''"
              data-testid="alert-rule-min-sample"
              @change="
                patchDraft({ minSampleCount: Number(($event.target as HTMLInputElement).value) })
              "
            />
            <span v-if="fieldErrors.minSampleCount" class="mon-error">{{
              fieldErrors.minSampleCount
            }}</span>
          </label>

          <label class="mon-field">
            冷却时间
            <select
              :value="draft.cooldownMinutes"
              data-testid="alert-rule-cooldown"
              @change="
                patchDraft({ cooldownMinutes: Number(($event.target as HTMLSelectElement).value) })
              "
            >
              <option
                v-for="cooldown in capability.cooldownsMinutes"
                :key="cooldown"
                :value="cooldown"
              >
                {{ cooldown }} 分钟
              </option>
            </select>
            <span v-if="fieldErrors.cooldownMinutes" class="mon-error">{{
              fieldErrors.cooldownMinutes
            }}</span>
          </label>

          <label class="mon-field">
            规则名称（可选）
            <input
              type="text"
              :value="draft.name ?? ''"
              data-testid="alert-rule-name"
              @change="onNameInput"
            />
          </label>

          <fieldset class="mon-field">
            <legend>接收成员（至少一个）</legend>
            <div v-if="capability.recipients.length > 0" class="mon-recipients">
              <label
                v-for="recipient in capability.recipients"
                :key="recipient.accountId"
                class="mon-check"
              >
                <input
                  type="checkbox"
                  :checked="draft.recipientAccountIds.includes(recipient.accountId)"
                  :data-testid="`recipient-${recipient.accountId}`"
                  @change="onRecipientToggle(recipient.accountId, $event)"
                />
                {{ recipient.maskedEmail }}
              </label>
            </div>
            <p v-else class="mon-hint">没有可选的接收成员。</p>
            <span v-if="fieldErrors.recipientAccountIds" class="mon-error">{{
              fieldErrors.recipientAccountIds
            }}</span>
          </fieldset>

          <p class="mon-hint" data-testid="alert-rule-filter-note">
            筛选维度当前无事件侧数据源（服务端返回 unavailable），本版规则作用于项目全部事件。
          </p>

          <p
            v-if="pendingMetric !== null"
            class="mon-confirm"
            role="alert"
            data-testid="alert-rule-metric-switch-confirm"
          >
            切换指标将清除字段：最小样本数。取消则保持当前草稿。
            <span class="mon-actions-inline">
              <button
                type="button"
                class="au-button"
                data-testid="alert-rule-confirm-switch"
                @click="confirmMetricSwitch"
              >
                确认切换
              </button>
              <button
                type="button"
                class="au-button"
                data-testid="alert-rule-cancel-switch"
                @click="cancelMetricSwitch"
              >
                取消
              </button>
            </span>
          </p>

          <div class="mon-actions-row">
            <button
              type="submit"
              class="au-button"
              data-testid="alert-rule-submit"
              :disabled="submitting"
            >
              {{ submitting ? '保存中…' : isEdit ? '保存修改' : '创建规则' }}
            </button>
          </div>
          <p v-if="submitError !== null" class="mon-notice mon-notice--error" role="status">
            {{ submitError }}
          </p>
        </template>
      </form>
    </template>
  </section>
</template>

<style scoped>
.mon-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 52ch;
}
.mon-field {
  display: inline-flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-field input,
.mon-field select {
  min-height: var(--control-height);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  font: inherit;
}
.mon-recipients {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.mon-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 13px;
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
.mon-error {
  color: var(--color-status-danger);
}
.mon-confirm {
  border: 1px solid var(--color-status-warning);
  border-radius: var(--radius-base);
  padding: var(--space-3);
  margin: 0;
}
.mon-actions-inline {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.mon-actions-row {
  margin-top: var(--space-2);
}
.mon-notice {
  margin: var(--space-2) 0 0;
  color: var(--color-text-secondary);
}
.mon-notice--error {
  color: var(--color-status-danger);
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
