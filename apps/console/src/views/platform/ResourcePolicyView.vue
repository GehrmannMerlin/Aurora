<script setup lang="ts">
/**
 * D2 平台资源策略（`platform.resource-policies`，PLT-10c）。
 *
 * 平台管理员页面，只消费 Task 1 公开 Query/Command：能力门禁
 * `platformAdminGetCapability`、目标搜索 `policyTargetSearch`、三个生效策略投影
 * `policyGetDefault`/`policyGetOrganizationEffective`/`policyGetProjectEffective`
 * 与五个命令（setDefault/setOrganization/resetOrganization/setProjectLimit/
 * clearProjectLimit）。能力 forbidden 时不渲染任何策略数据（诚实"无权限"）；
 * 传播状态第一版恒 `unknown`（如实展示"未确认"，绝不宣称已生效）；命令全部经
 * session CSRF + 全新幂等键，成功后重新拉取权威投影；`version_conflict` 重新拉取
 * 服务端当前值并提示重新确认，`field_validation` 就地显示。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { describeRequestError } from '../../api/feedback.js';
import { ApiError } from '../../api/errors.js';
import { invalidateScope } from '../../api/query.js';
import { createIdempotencyKey } from '../../api/client.js';
import {
  fetchPlatformAdminCapability,
  fetchPolicyGetDefault,
  fetchPolicyGetOrganizationEffective,
  fetchPolicyGetProjectEffective,
  fetchPolicyTargetSearch,
  type PlatformPolicyFields,
  type PlatformPolicyProjection,
  type PolicyTargetOrganization,
  type PolicyTargetProject,
  type ProjectPolicyProjection,
} from '../../monitoring/queries.js';
import {
  clearPolicyProjectLimit,
  resetPolicyOrganization,
  setPolicyDefault,
  setPolicyOrganization,
  setPolicyProjectLimit,
  type PolicyFieldsCommandInput,
} from '../../monitoring/commands.js';
import type { SectionResult } from '../../monitoring/section.js';
import { formatUtc } from '../../monitoring/format.js';
import { useSessionStore } from '../../stores/session.js';
import {
  buildResourcePolicyView,
  fieldsRequireConfirm,
  formatConfigValue,
  policySourceLabel,
  propagationLabel,
  validateProjectLimitInput,
  versionConflictView,
  type PolicyTargetSelection,
  type ResourcePolicyCommandPhase,
} from './resource-policy-view-model.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';

const session = useSessionStore();

const capability = ref<'checking' | 'ready' | 'forbidden'>('checking');
const target = ref<PolicyTargetSelection>('default');
const selectedTargetKey = ref('default');
const projectionSection = ref<SectionResult<
  PlatformPolicyProjection | ProjectPolicyProjection
> | null>(null);
const projectionLoading = ref(false);
const commandPhase = ref<ResourcePolicyCommandPhase>({ kind: 'idle' });
const version = ref(0);
const conflict = ref<string | null>(null);
const currentProjection = ref<PlatformPolicyProjection | ProjectPolicyProjection | null>(null);

const searchQuery = ref('');
const searching = ref(false);
const searchError = ref<string | null>(null);
const searchResults = ref<{
  readonly organizations: readonly PolicyTargetOrganization[];
  readonly projects: readonly PolicyTargetProject[];
}>({ organizations: [], projects: [] });
let searchTimer: ReturnType<typeof setTimeout> | undefined;
/** Monotonic per-component projection-fetch counter: only the latest fetch may write state or clear loading. */
let projectionRequestSeq = 0;

const formQuota = ref(0);
const formWarningRatio = ref(0);
const formHardLimit = ref(0);
const formDegradation = ref(false);
const formRetentionDays = ref(0);
const formResourceLimit = ref('');

const FIVE_FIELD_KEYS: { key: keyof PlatformPolicyFields; label: string }[] = [
  { key: 'defaultPeriodQuota', label: '周期配额' },
  { key: 'warningRatio', label: '告警比例' },
  { key: 'hardLimit', label: '硬性上限' },
  { key: 'degradationEnabled', label: '降级保护' },
  { key: 'highValueRetentionDays', label: '高价值数据保留' },
];

const state = computed(() =>
  buildResourcePolicyView({
    capability: capability.value,
    target: target.value,
    projectionSection: projectionSection.value,
    projectionLoading: projectionLoading.value,
    commandPhase: commandPhase.value,
    version: version.value,
    conflict: conflict.value,
  }),
);

const versionConflict = computed(() =>
  versionConflictView({ conflict: state.value.conflict, version: state.value.version }),
);

const commandError = computed(() =>
  state.value.commandPhase.kind === 'error' ? state.value.commandPhase.message : null,
);

const projectionData = computed<PlatformPolicyProjection | ProjectPolicyProjection | null>(() =>
  state.value.projection.kind === 'available' ? state.value.projection.data : null,
);

const isProjectTarget = computed(
  () => target.value !== 'default' && target.value.type === 'project',
);

const orgPolicy = computed<PlatformPolicyProjection | null>(() =>
  !isProjectTarget.value && projectionData.value !== null
    ? (projectionData.value as PlatformPolicyProjection)
    : null,
);

const projectPolicy = computed<ProjectPolicyProjection | null>(() =>
  isProjectTarget.value && projectionData.value !== null
    ? (projectionData.value as ProjectPolicyProjection)
    : null,
);

const projectLimitSet = computed(() => projectPolicy.value?.configured.resourceLimit !== undefined);

const targetLabel = computed(() => {
  if (target.value === 'default') return '平台默认';
  return target.value.type === 'organization'
    ? `组织 · ${target.value.name}`
    : `项目 · ${target.value.name}`;
});

/** Keep the currently selected target in the select even when search results are cleared. */
const targetOptions = computed(() => {
  const options: { key: string; label: string }[] = [{ key: 'default', label: '平台默认' }];
  for (const org of searchResults.value.organizations) {
    options.push({ key: `org:${org.organizationId}`, label: `组织 · ${org.name}` });
  }
  for (const prj of searchResults.value.projects) {
    options.push({ key: `prj:${prj.projectId}`, label: `项目 · ${prj.name}` });
  }
  if (target.value !== 'default') {
    const key =
      target.value.type === 'organization' ? `org:${target.value.id}` : `prj:${target.value.id}`;
    if (!options.some((option) => option.key === key)) {
      options.push({
        key,
        label:
          target.value.type === 'organization'
            ? `组织 · ${target.value.name}`
            : `项目 · ${target.value.name}`,
      });
    }
  }
  return options;
});

async function loadCapability(): Promise<void> {
  capability.value = 'checking';
  try {
    const resolved = await fetchPlatformAdminCapability();
    capability.value = resolved.hasCapability ? 'ready' : 'forbidden';
  } catch (caught) {
    // Fail closed: without a confirmed capability we never render policy data.
    capability.value = 'forbidden';
  }
  if (capability.value === 'ready') {
    await loadProjection();
  }
}

function seedForm(projection: PlatformPolicyProjection | ProjectPolicyProjection): void {
  if (isProjectTarget.value) {
    const p = projection as ProjectPolicyProjection;
    formResourceLimit.value =
      p.configured.resourceLimit === undefined ? '' : String(p.configured.resourceLimit);
  } else {
    const p = projection as PlatformPolicyProjection;
    formQuota.value = p.configured.defaultPeriodQuota;
    formWarningRatio.value = p.configured.warningRatio;
    formHardLimit.value = p.configured.hardLimit;
    formDegradation.value = p.configured.degradationEnabled;
    formRetentionDays.value = p.configured.highValueRetentionDays;
  }
}

async function loadProjection(opts: { preserveConflict?: boolean } = {}): Promise<void> {
  const requestedTarget = target.value;
  const seq = ++projectionRequestSeq;
  if (!opts.preserveConflict) conflict.value = null;
  // Clear a stale command error/confirmation from a previous target so it never
  // lingers while the user is now viewing (or reloading) a different target.
  commandPhase.value = { kind: 'idle' };
  projectionSection.value = null;
  projectionLoading.value = true;
  try {
    let data: PlatformPolicyProjection | ProjectPolicyProjection;
    if (requestedTarget === 'default') {
      data = await fetchPolicyGetDefault();
    } else if (requestedTarget.type === 'organization') {
      data = await fetchPolicyGetOrganizationEffective(requestedTarget.id);
    } else {
      data = await fetchPolicyGetProjectEffective(requestedTarget.id);
    }
    if (seq !== projectionRequestSeq) return; // stale response
    version.value = data.version;
    currentProjection.value = data;
    projectionSection.value = { status: 'available', data };
    seedForm(data);
  } catch (caught) {
    if (seq !== projectionRequestSeq) return; // stale response
    version.value = 0;
    currentProjection.value = null;
    if (caught instanceof ApiError && caught.code === 'authorization') {
      projectionSection.value = { status: 'forbidden' };
    } else if (caught instanceof ApiError && caught.code === 'not_found') {
      projectionSection.value = { status: 'unavailable', reason: '目标不存在或已被删除。' };
    } else {
      projectionSection.value = { status: 'unavailable', reason: describeRequestError(caught) };
    }
  } finally {
    if (seq === projectionRequestSeq) projectionLoading.value = false;
  }
}

async function runSearch(): Promise<void> {
  const q = searchQuery.value.trim();
  if (q.length === 0) {
    searching.value = false;
    searchError.value = null;
    searchResults.value = { organizations: [], projects: [] };
    return;
  }
  searching.value = true;
  searchError.value = null;
  try {
    const result = await fetchPolicyTargetSearch({ q, limit: 20 });
    searchResults.value = { organizations: result.organizations, projects: result.projects };
  } catch (caught) {
    searchResults.value = { organizations: [], projects: [] };
    searchError.value = describeRequestError(caught);
  } finally {
    searching.value = false;
  }
}

function onTargetSelect(event: Event): void {
  applyTarget((event.target as HTMLSelectElement).value);
}

function applyTarget(key: string): void {
  selectedTargetKey.value = key;
  if (key === 'default') {
    target.value = 'default';
  } else if (key.startsWith('org:')) {
    const id = key.slice('org:'.length);
    const org = searchResults.value.organizations.find(
      (candidate) => candidate.organizationId === id,
    );
    if (org !== undefined)
      target.value = { type: 'organization', id: org.organizationId, name: org.name };
  } else if (key.startsWith('prj:')) {
    const id = key.slice('prj:'.length);
    const prj = searchResults.value.projects.find((candidate) => candidate.projectId === id);
    if (prj !== undefined) target.value = { type: 'project', id: prj.projectId, name: prj.name };
  }
  void loadProjection();
}

async function runCommand(task: () => Promise<unknown>): Promise<void> {
  if (commandPhase.value.kind === 'submitting') return;
  commandPhase.value = { kind: 'submitting' };
  try {
    await task();
    invalidateScope({ type: 'account' });
    commandPhase.value = { kind: 'idle' };
    await loadProjection();
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === 'version_conflict') {
      conflict.value = '数据已更新，请重新确认。';
      invalidateScope({ type: 'account' });
      await loadProjection({ preserveConflict: true });
      commandPhase.value = { kind: 'idle' };
    } else if (caught instanceof ApiError && caught.code === 'field_validation') {
      commandPhase.value = { kind: 'error', message: '输入内容不符合要求，请检查后重试。' };
    } else if (caught instanceof ApiError && caught.code === 'authorization') {
      commandPhase.value = { kind: 'error', message: '你没有权限执行该操作。' };
    } else {
      commandPhase.value = { kind: 'error', message: describeRequestError(caught) };
    }
  }
}

/** Whether the edited five fields lower a cap, enable degradation, or change retention. */
function targetOrgId(): string | null {
  if (target.value !== 'default' && target.value.type === 'organization') return target.value.id;
  return null;
}

function savePolicyFields(): void {
  if (commandPhase.value.kind === 'submitting') return;
  const projection = orgPolicy.value;
  if (projection === null) return;
  const draft = {
    defaultPeriodQuota: formQuota.value,
    warningRatio: formWarningRatio.value,
    hardLimit: formHardLimit.value,
    degradationEnabled: formDegradation.value,
    highValueRetentionDays: formRetentionDays.value,
  };
  if (fieldsRequireConfirm(draft, projection.configured)) {
    if (
      !window.confirm(
        '该修改会降低配额/上限、启用降级保护或改变保留期限，可能影响关联组织与项目。确定保存？',
      )
    ) {
      return;
    }
  }
  const fields: PolicyFieldsCommandInput = {
    defaultPeriodQuota: formQuota.value,
    warningRatio: formWarningRatio.value,
    hardLimit: formHardLimit.value,
    degradationEnabled: formDegradation.value,
    highValueRetentionDays: formRetentionDays.value,
  };
  const orgId = targetOrgId();
  const options = { csrf: session.csrf ?? '', idempotencyKey: createIdempotencyKey() };
  void runCommand(() =>
    orgId === null
      ? setPolicyDefault({ ...fields, version: version.value }, options)
      : setPolicyOrganization(orgId, { ...fields, version: version.value }, options),
  );
}

function resetOrgOverride(): void {
  if (commandPhase.value.kind === 'submitting') return;
  const orgId = targetOrgId();
  if (orgId === null) return;
  if (!window.confirm('重置后该组织将继承平台默认策略，当前覆盖将被删除并写入审计。确定重置？'))
    return;
  void runCommand(() =>
    resetPolicyOrganization(
      orgId,
      { version: version.value },
      { csrf: session.csrf ?? '', idempotencyKey: createIdempotencyKey() },
    ),
  );
}

function saveProjectLimit(): void {
  if (commandPhase.value.kind === 'submitting') return;
  if (target.value === 'default' || target.value.type !== 'project') return;
  const projectId = target.value.id;
  const parsed = validateProjectLimitInput(formResourceLimit.value);
  if (parsed === null) {
    commandPhase.value = { kind: 'error', message: '请输入有效的项目资源上限。' };
    return;
  }
  const current = currentProjection.value;
  const currentLimit =
    current !== null && 'resourceLimit' in current.configured
      ? current.configured.resourceLimit
      : undefined;
  if (currentLimit !== undefined && parsed < currentLimit) {
    if (!window.confirm('降低项目资源上限会影响该项目的用量。确定保存？')) return;
  }
  void runCommand(() =>
    setPolicyProjectLimit(
      projectId,
      { resourceLimit: parsed, version: version.value },
      { csrf: session.csrf ?? '', idempotencyKey: createIdempotencyKey() },
    ),
  );
}

function clearProjectLimit(): void {
  if (commandPhase.value.kind === 'submitting') return;
  if (target.value === 'default' || target.value.type !== 'project') return;
  const projectId = target.value.id;
  if (!window.confirm('清除后该项目将继承组织/平台继承的资源上限，不再单独设置。确定清除？'))
    return;
  void runCommand(() =>
    clearPolicyProjectLimit(
      projectId,
      { version: version.value },
      { csrf: session.csrf ?? '', idempotencyKey: createIdempotencyKey() },
    ),
  );
}

onMounted(() => {
  void loadCapability();
});

watch(searchQuery, () => {
  if (searchTimer !== undefined) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void runSearch();
  }, 250);
});

onBeforeUnmount(() => {
  if (searchTimer !== undefined) clearTimeout(searchTimer);
});
</script>

<template>
  <div class="resource-policy-workspace" data-testid="resource-policy-view">
    <AppPageHeader title="资源策略" />

    <SectionNotice v-if="state.capability !== 'ready'" :view="state.projection" />

    <template v-else>
      <section class="rp-block" data-testid="rp-target-picker">
        <h2 class="rp-title">策略目标</h2>
        <p class="rp-hint">
          选择平台默认策略，或搜索组织/项目后查看与编辑其生效资源策略。第一版传播状态恒为「未确认」。
        </p>
        <div class="rp-target-row">
          <label class="rp-field">
            目标范围
            <select
              :value="selectedTargetKey"
              data-testid="rp-target-select"
              @change="onTargetSelect"
            >
              <option v-for="option in targetOptions" :key="option.key" :value="option.key">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label class="rp-field rp-field--search">
            搜索组织/项目
            <input
              v-model="searchQuery"
              type="search"
              placeholder="按名称搜索组织或项目"
              data-testid="rp-target-search"
            />
            <span v-if="searching" class="rp-field-hint">搜索中…</span>
          </label>
        </div>
        <p v-if="searchError !== null" class="rp-error" role="status" data-testid="rp-search-error">
          {{ searchError }}
        </p>
      </section>

      <SectionNotice v-if="state.projection.kind !== 'available'" :view="state.projection" />

      <template v-else>
        <section class="rp-block" data-testid="rp-effective-policy">
          <h2 class="rp-title">生效策略</h2>
          <dl class="rp-dl">
            <dt>目标</dt>
            <dd>{{ targetLabel }}</dd>
            <dt>策略来源</dt>
            <dd v-if="orgPolicy !== null" data-testid="rp-policy-source">
              {{ policySourceLabel(orgPolicy.source) }}
            </dd>
            <dd v-else-if="projectPolicy !== null" data-testid="rp-policy-source">
              {{ policySourceLabel(projectPolicy.source) }}
            </dd>
            <dt>版本</dt>
            <dd v-if="orgPolicy !== null">{{ orgPolicy.version }}</dd>
            <dd v-else-if="projectPolicy !== null">{{ projectPolicy.version }}</dd>
            <dt>传播状态</dt>
            <dd v-if="orgPolicy !== null" data-testid="rp-policy-propagation">
              {{ propagationLabel(orgPolicy.propagation.status) }}
            </dd>
            <dd v-else-if="projectPolicy !== null" data-testid="rp-policy-propagation">
              {{ propagationLabel(projectPolicy.propagation.status) }}
            </dd>
            <template v-if="(orgPolicy?.updatedAt ?? projectPolicy?.updatedAt) !== undefined">
              <dt>更新于</dt>
              <dd>{{ formatUtc((orgPolicy?.updatedAt ?? projectPolicy?.updatedAt) as string) }}</dd>
            </template>
          </dl>

          <table v-if="orgPolicy !== null" class="rp-table" data-testid="rp-policy-evidence-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>已配置值</th>
                <th>已配置值</th>
                <th>来源</th>
                <th>生效值</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="field in FIVE_FIELD_KEYS" :key="field.key">
                <td>{{ field.label }}</td>
                <td>{{ formatConfigValue(field.key, orgPolicy.configured[field.key]) }}</td>
                <td>{{ policySourceLabel(orgPolicy.source) }}</td>
                <td>{{ formatConfigValue(field.key, orgPolicy.effective[field.key]) }}</td>
              </tr>
            </tbody>
          </table>

          <table v-else-if="projectPolicy !== null" class="rp-table" data-testid="rp-policy-evidence-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>来源</th>
                <th>生效值</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>项目资源上限</td>
                <td>
                  {{
                    projectPolicy.configured.resourceLimit !== undefined
                      ? formatConfigValue('resourceLimit', projectPolicy.configured.resourceLimit)
                      : '未设置（继承）'
                  }}
                </td>
                <td>{{ policySourceLabel(projectPolicy.source) }}</td>
                <td>
                  {{
                    projectPolicy.effective.resourceLimit !== undefined
                      ? formatConfigValue('resourceLimit', projectPolicy.effective.resourceLimit)
                      : '未设置（继承）'
                  }}
                </td>
              </tr>
              <tr v-for="field in FIVE_FIELD_KEYS" :key="field.key">
                <td>{{ field.label }}</td>
                <td>未单独设置</td>
                <td>{{ policySourceLabel(projectPolicy.source) }}</td>
                <td>{{ formatConfigValue(field.key, projectPolicy.effective[field.key]) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section
          v-if="orgPolicy !== null"
          class="rp-block"
          :data-testid="target === 'default' ? 'rp-platform-default-editor' : 'rp-organization-override-editor'"
        >
          <h2 class="rp-title">{{ target === 'default' ? '平台默认策略' : '组织覆盖策略' }}</h2>
          <p class="rp-hint">
            保存将写入平台审计；降低上限、启用降级保护或改变保留期限需二次确认。
          </p>
          <div class="rp-form-grid">
            <label class="rp-field">
              周期配额（事件/月）
              <input
                v-model.number="formQuota"
                type="number"
                min="1"
                step="1"
                data-testid="rp-input-quota"
              />
            </label>
            <label class="rp-field">
              告警比例（%）
              <input
                v-model.number="formWarningRatio"
                type="number"
                min="1"
                max="100"
                step="1"
                data-testid="rp-input-warning-ratio"
              />
            </label>
            <label class="rp-field">
              硬性上限（%）
              <input
                v-model.number="formHardLimit"
                type="number"
                min="1"
                max="100"
                step="1"
                data-testid="rp-input-hard-limit"
              />
            </label>
            <label class="rp-field">
              降级保护
              <select v-model="formDegradation" data-testid="rp-input-degradation">
                <option :value="true">开启</option>
                <option :value="false">关闭</option>
              </select>
            </label>
            <label class="rp-field">
              高价值数据保留（天）
              <input
                v-model.number="formRetentionDays"
                type="number"
                min="1"
                step="1"
                data-testid="rp-input-retention"
              />
            </label>
          </div>
          <div class="rp-actions-row">
            <button
              type="button"
              class="au-button"
              :disabled="state.commandPhase.kind === 'submitting'"
              data-testid="rp-fields-save"
              @click="savePolicyFields"
            >
              {{ state.commandPhase.kind === 'submitting' ? '保存中…' : '保存' }}
            </button>
            <button
              v-if="target !== 'default'"
              type="button"
              class="au-button au-button--danger"
              :disabled="state.commandPhase.kind === 'submitting'"
              data-testid="rp-org-reset"
              @click="resetOrgOverride"
            >
              重置为平台默认
            </button>
          </div>
        </section>

        <section v-if="projectPolicy !== null" class="rp-block" data-testid="rp-project-limit-editor">
          <h2 class="rp-title">项目资源上限</h2>
          <p class="rp-hint">
            设置项目专属资源上限；未设置时继承组织/平台默认。清除覆盖后回到继承状态。
          </p>
          <label class="rp-field">
            项目资源上限（事件/月）
            <input
              v-model="formResourceLimit"
              type="number"
              min="1"
              step="1"
              placeholder="留空表示未设置"
              data-testid="rp-input-resource-limit"
            />
          </label>
          <div class="rp-actions-row">
            <button
              type="button"
              class="au-button"
              :disabled="state.commandPhase.kind === 'submitting'"
              data-testid="rp-project-save"
              @click="saveProjectLimit"
            >
              {{ state.commandPhase.kind === 'submitting' ? '保存中…' : '保存上限' }}
            </button>
            <button
              v-if="projectLimitSet"
              type="button"
              class="au-button au-button--danger"
              :disabled="state.commandPhase.kind === 'submitting'"
              data-testid="rp-project-clear"
              @click="clearProjectLimit"
            >
              清除覆盖
            </button>
          </div>
        </section>
      </template>
    </template>

    <p v-if="versionConflict.active" class="rp-conflict" role="status" data-testid="rp-conflict">
      {{ versionConflict.message }}
    </p>
    <p v-if="commandError !== null" class="rp-error" role="status" data-testid="rp-command-error">
      {{ commandError }}
    </p>
  </div>
</template>

<style scoped>
.resource-policy-workspace {
  max-width: 960px;
  margin: 0 auto;
}
.rp-block {
  margin-bottom: var(--space-5);
}
.rp-title {
  margin: 0 0 var(--space-2);
  font-size: 16px;
  color: var(--color-text-primary);
}
.rp-hint {
  color: var(--color-text-secondary);
  max-width: 60ch;
  margin: 0 0 var(--space-2);
}
.rp-target-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: flex-start;
}
.rp-field {
  display: inline-flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--color-text-secondary);
  font-size: 12px;
  min-width: 200px;
}
.rp-field--search {
  flex: 1;
  min-width: 260px;
}
.rp-field input,
.rp-field select {
  min-height: var(--control-height);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  font: inherit;
}
.rp-field-hint {
  font-size: 12px;
  color: var(--color-text-muted, #8a8376);
}
.rp-dl {
  margin: 0 0 var(--space-3);
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-1) var(--space-3);
}
.rp-dl dt {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.rp-dl dd {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-primary);
}
.rp-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: var(--space-4);
}
.rp-table th,
.rp-table td {
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border, #ece7dc);
  font-size: 14px;
  color: var(--color-text-primary);
}
.rp-table th {
  color: var(--color-text-secondary);
  font-weight: 600;
  font-size: 12px;
}
.rp-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.rp-actions-row {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
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
.au-button--danger {
  border-color: var(--color-status-danger);
  color: var(--color-status-danger);
}
.rp-conflict {
  color: var(--color-status-warning, #b7791f);
  margin: var(--space-3) 0;
}
.rp-error {
  color: var(--color-status-danger);
  margin: var(--space-3) 0;
}
</style>
