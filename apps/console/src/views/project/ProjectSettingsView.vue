<script setup lang="ts">
/**
 * C15 项目设置（`project.settings`，PLT-08）。
 *
 * 双标签 `?tab=general|environments`（URL 权威，默认 general）。只消费 C15
 * 公开契约：`settingsGetProject` / `settingsUpdateProject` / `settingsListEnvironments`
 * / `settingsCreateEnvironment`。框架/接入类型只读；环境创建后不可改名/停用/删除。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { ApiError } from '../../api/errors.js';
import { invalidateScope } from '../../api/query.js';
import { createIdempotencyKey } from '../../api/client.js';
import {
  fetchProjectEnvironments,
  fetchProjectSettings,
  type ProjectEnvironmentsData,
  type ProjectSettingsData,
} from '../../monitoring/queries.js';
import { createProjectEnvironment, updateProjectSettings } from '../../monitoring/commands.js';
import { useSessionStore } from '../../stores/session.js';
import { buildSettingsView, frameworkLabel } from './settings-view-model.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const scope = { organizationId, projectId };

const tab = computed<'general' | 'environments'>(() => {
  const raw = route.query.tab;
  return raw === 'environments' ? 'environments' : 'general';
});

const settings = ref<ProjectSettingsData | null>(null);
const environments = ref<ProjectEnvironmentsData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const nameInput = ref('');
const websiteUrlInput = ref('');
const saveBusy = ref(false);
const saveError = ref<string | null>(null);
const envNameInput = ref('');
const envBusy = ref(false);
const envError = ref<string | null>(null);
const generalTab = ref<HTMLButtonElement | null>(null);
const environmentsTab = ref<HTMLButtonElement | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [settingsData, envData] = await Promise.all([
      fetchProjectSettings(scope),
      fetchProjectEnvironments(scope),
    ]);
    settings.value = settingsData;
    environments.value = envData;
    nameInput.value = settingsData.project.name;
    websiteUrlInput.value = settingsData.project.websiteUrl ?? '';
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
  buildSettingsView({
    loading: loading.value,
    error: error.value,
    project: settings.value?.project ?? null,
    environments: environments.value?.environments ?? null,
  }),
);

async function setTab(next: 'general' | 'environments'): Promise<void> {
  if (next === tab.value) return;
  await router.push({ query: { ...route.query, tab: next } });
}

async function moveTabFocus(event: KeyboardEvent): Promise<void> {
  let next: 'general' | 'environments' | null = null;
  if (event.key === 'ArrowLeft' || event.key === 'Home') next = 'general';
  if (event.key === 'ArrowRight' || event.key === 'End') next = 'environments';
  if (next === null) return;

  event.preventDefault();
  await setTab(next);
  (next === 'general' ? generalTab.value : environmentsTab.value)?.focus();
}

async function submitSettings(): Promise<void> {
  if (saveBusy.value || settings.value === null) return;
  const name = nameInput.value.trim();
  if (name.length < 2) {
    saveError.value = '项目名称至少 2 个字符。';
    return;
  }
  saveBusy.value = true;
  saveError.value = null;
  try {
    const body: { name: string; websiteUrl?: string; resourceVersion: string } = {
      name,
      resourceVersion: settings.value.project.resourceVersion,
    };
    const trimmedUrl = websiteUrlInput.value.trim();
    if (trimmedUrl !== '') body.websiteUrl = trimmedUrl;
    await updateProjectSettings(scope, body, {
      csrf: session.csrf ?? '',
      idempotencyKey: createIdempotencyKey(),
    });
    invalidateScope({ type: 'project', id: projectId });
    await load();
  } catch (caught) {
    if (caught instanceof ApiError) {
      if (caught.code === 'version_conflict') {
        saveError.value = '设置已被其他成员修改，已刷新权威值，请重新确认后保存。';
        await load();
      } else if (caught.code === 'authorization') {
        saveError.value = '你没有修改该项目设置的权限。';
      } else {
        saveError.value = describeRequestError(caught);
      }
    } else {
      saveError.value = describeRequestError(caught);
    }
  } finally {
    saveBusy.value = false;
  }
}

async function submitCreateEnvironment(): Promise<void> {
  const name = envNameInput.value.trim();
  if (name === '' || envBusy.value) return;
  envBusy.value = true;
  envError.value = null;
  try {
    await createProjectEnvironment(
      scope,
      { name },
      {
        csrf: session.csrf ?? '',
        idempotencyKey: createIdempotencyKey(),
      },
    );
    envNameInput.value = '';
    invalidateScope({ type: 'project', id: projectId });
    const envData = await fetchProjectEnvironments(scope);
    environments.value = envData;
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === 'field_validation') {
      envError.value = '该环境名称已存在或格式无效。';
    } else {
      envError.value = describeRequestError(caught);
    }
  } finally {
    envBusy.value = false;
  }
}
</script>

<template>
  <section class="au-surface" data-testid="project-settings-view">
    <AppPageHeader title="设置" />

    <nav class="mon-tabs" role="tablist" aria-label="设置标签">
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'general'"
        :class="{ 'is-active': tab === 'general' }"
        data-testid="tab-general"
        ref="generalTab"
        @click="void setTab('general')"
        @keydown="void moveTabFocus($event)"
      >
        基本设置
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'environments'"
        :class="{ 'is-active': tab === 'environments' }"
        data-testid="tab-environments"
        ref="environmentsTab"
        @click="void setTab('environments')"
        @keydown="void moveTabFocus($event)"
      >
        运行环境
      </button>
    </nav>

    <template v-if="tab === 'general'">
      <section class="settings-workspace" data-testid="settings-general-workspace">
        <template v-if="state.project.kind === 'loading'">
          <p class="mon-hint" role="status">正在加载设置…</p>
        </template>
        <template v-else-if="state.project.kind !== 'available'">
          <SectionNotice :view="state.project" />
        </template>
        <template v-else>
          <form class="mon-form" @submit.prevent="submitSettings">
            <label class="mon-field">
              项目名称
              <input type="text" v-model="nameInput" data-testid="settings-name" />
            </label>
            <label class="mon-field">
              生产网站地址（可选）
              <input
                type="text"
                v-model="websiteUrlInput"
                placeholder="https://example.com"
                data-testid="settings-website"
              />
            </label>
            <p class="mon-meta">
              框架/接入类型：{{ frameworkLabel(state.project.data.frameworkType) }}（只读）
            </p>
            <div class="mon-actions-row">
              <button
                type="submit"
                class="au-button"
                data-testid="settings-save"
                :disabled="saveBusy"
              >
                {{ saveBusy ? '保存中…' : '保存设置' }}
              </button>
            </div>
            <p v-if="saveError !== null" class="mon-notice mon-notice--error" role="status">
              {{ saveError }}
            </p>
          </form>
        </template>
      </section>
    </template>

    <template v-else>
      <section class="settings-workspace" data-testid="settings-environments-workspace">
        <h2 class="mon-title">运行环境</h2>
        <template v-if="state.environments.kind === 'loading'">
          <p class="mon-hint" role="status">正在加载环境…</p>
        </template>
        <template v-else-if="state.environments.kind !== 'available'">
          <SectionNotice :view="state.environments" />
        </template>
        <template v-else>
          <div v-if="state.environments.data.length > 0" class="environment-table-wrap">
            <table class="environment-table" data-testid="settings-environment-table">
              <thead>
                <tr>
                  <th>环境</th>
                  <th>状态</th>
                  <th>技术标识</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="env in state.environments.data" :key="env.environmentId">
                  <td class="mon-env-name">{{ env.name }}</td>
                  <td>
                    <span v-if="env.isDefault === 'true'" class="mon-badge">默认</span>
                    <span v-else class="mon-meta">可用</span>
                  </td>
                  <td class="mon-meta"><code>{{ env.environmentId }}</code></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="mon-hint">项目尚无环境。</p>

          <div class="mon-env-create">
            <label class="mon-field">
              新环境名称（创建后不可改名）
              <input
                type="text"
                v-model="envNameInput"
                placeholder="staging"
                data-testid="settings-env-name"
              />
            </label>
            <button
              type="button"
              class="au-button"
              data-testid="settings-env-create"
              :disabled="envBusy || envNameInput.trim() === ''"
              @click="submitCreateEnvironment"
            >
              {{ envBusy ? '创建中…' : '创建环境' }}
            </button>
          </div>
          <p v-if="envError !== null" class="mon-notice mon-notice--error" role="status">
            {{ envError }}
          </p>
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
.settings-workspace {
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
.mon-field input {
  min-height: var(--control-height);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  font: inherit;
}
.environment-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-surface);
  margin-bottom: var(--space-3);
}
.environment-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 520px;
}
.environment-table th,
.environment-table td {
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border-default);
  text-align: left;
}
.environment-table th {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.environment-table tbody tr:last-child td {
  border-bottom: 0;
}
.mon-env-name {
  font-weight: 600;
}
.mon-badge {
  display: inline-block;
  padding: 1px var(--space-2);
  border-radius: var(--radius-base);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-env-create {
  display: flex;
  gap: var(--space-3);
  align-items: flex-end;
  max-width: 52ch;
}
.mon-actions-row {
  margin-top: var(--space-2);
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
.mon-notice {
  margin: var(--space-2) 0 0;
  color: var(--color-text-secondary);
}
.mon-notice--error {
  color: var(--color-status-danger);
}
</style>
