<script setup lang="ts">
/**
 * C13 项目访问（`project.access`，PLT-08）。
 *
 * 只消费 `accessListEffectiveMembers`（C13）服务端权威投影。组织继承来源只读；
 * 项目显式关系由 `allowedActions` 行级投影驱动写操作，服务端每次重鉴权
 * （org manager 或 project_admin）。授予需要输入当前组织成员 accountId。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { ApiError } from '../../api/errors.js';
import { invalidateScope } from '../../api/query.js';
import { createIdempotencyKey } from '../../api/client.js';
import {
  fetchEffectiveMembers,
  type EffectiveMember,
  type EffectiveMembersData,
} from '../../monitoring/queries.js';
import {
  changeProjectRole,
  grantProjectMembership,
  removeProjectMembership,
  type ProjectRoleValue,
} from '../../monitoring/commands.js';
import { useSessionStore } from '../../stores/session.js';
import {
  buildAccessView,
  canManageMember,
  effectiveRoleLabel,
  sourceLabel,
} from './access-view-model.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';

const route = useRoute();
const session = useSessionStore();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const scope = { organizationId, projectId };

const data = ref<EffectiveMembersData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const grantAccountId = ref('');
const grantRole = ref<ProjectRoleValue>('developer');
const grantBusy = ref(false);
const grantError = ref<string | null>(null);
const actionBusy = ref<string | null>(null);
const actionError = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    data.value = await fetchEffectiveMembers(scope);
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
  buildAccessView({
    loading: loading.value,
    error: error.value,
    members: data.value?.members ?? null,
  }),
);

function describeCommandError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.code === 'authorization') return '你没有管理该项目访问的权限。';
    if (caught.code === 'business_validation') return '该账号已是项目成员或状态不允许该操作。';
    if (caught.code === 'not_found') return '项目或账号不存在。';
  }
  return describeRequestError(caught);
}

async function runAction(key: string, task: () => Promise<unknown>): Promise<void> {
  if (actionBusy.value !== null) return;
  actionBusy.value = key;
  actionError.value = null;
  try {
    await task();
    invalidateScope({ type: 'project', id: projectId });
    await load();
  } catch (caught) {
    actionError.value = describeCommandError(caught);
  } finally {
    actionBusy.value = null;
  }
}

async function submitGrant(): Promise<void> {
  const accountId = grantAccountId.value.trim();
  if (accountId === '' || grantBusy.value) return;
  grantBusy.value = true;
  grantError.value = null;
  try {
    await grantProjectMembership(
      scope,
      { accountId, role: grantRole.value },
      {
        csrf: session.csrf ?? '',
        idempotencyKey: createIdempotencyKey(),
      },
    );
    grantAccountId.value = '';
    invalidateScope({ type: 'project', id: projectId });
    await load();
  } catch (caught) {
    grantError.value = describeCommandError(caught);
  } finally {
    grantBusy.value = false;
  }
}

function changeRole(member: EffectiveMember, role: string): void {
  void runAction(member.accountId, () =>
    changeProjectRole(
      scope,
      member.accountId,
      { role: role as ProjectRoleValue },
      {
        csrf: session.csrf ?? '',
        idempotencyKey: createIdempotencyKey(),
      },
    ),
  );
}

function removeMember(member: EffectiveMember): void {
  void runAction(member.accountId, () =>
    removeProjectMembership(scope, member.accountId, {
      csrf: session.csrf ?? '',
      idempotencyKey: createIdempotencyKey(),
    }),
  );
}

function memberTone(effectiveRole: string): 'neutral' | 'success' | 'warning' {
  if (effectiveRole === 'project_admin') return 'warning';
  if (effectiveRole === 'developer') return 'success';
  return 'neutral';
}
</script>

<template>
  <section class="au-surface" data-testid="project-access-view">
    <AppPageHeader title="访问" />

    <section class="mon-block" data-testid="access-members">
      <h2 class="mon-title">有效访问清单</h2>
      <template v-if="state.members.kind === 'loading'">
        <p class="mon-hint" role="status">正在加载成员清单…</p>
      </template>
      <template v-else-if="state.members.kind !== 'available'">
        <SectionNotice :view="state.members" />
      </template>
      <template v-else>
        <div v-if="state.members.data.length > 0" class="governance-table-wrap">
          <table class="governance-table" data-testid="access-members-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>有效角色</th>
                <th>角色来源</th>
                <th>项目角色</th>
                <th><span class="sr-only">成员操作</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="member in state.members.data" :key="member.accountId">
                <td class="mon-email">{{ member.maskedEmail }}</td>
                <td data-testid="member-effective-role">
                  <AppStatusBadge :tone="memberTone(member.effectiveRole)">
                    {{ effectiveRoleLabel(member.effectiveRole) }}
                  </AppStatusBadge>
                </td>
                <td class="mon-meta" data-testid="member-role-source">
                  {{ member.sources.map(sourceLabel).join(' · ') }}
                </td>
                <td class="mon-meta">
                  {{ member.projectRole === undefined ? '未单独设置' : effectiveRoleLabel(member.projectRole) }}
                </td>
                <td>
                  <div v-if="canManageMember(member)" :data-testid="`member-actions-${member.accountId}`">
                    <label class="mon-field-inline">
                      <span class="sr-only">调整角色</span>
                      <select
                        :value="member.projectRole ?? member.effectiveRole"
                        :disabled="actionBusy !== null"
                        @change="changeRole(member, ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="project_admin">项目管理员</option>
                        <option value="developer">开发成员</option>
                        <option value="read_only">只读成员</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      class="au-button au-button--danger"
                      :disabled="actionBusy !== null"
                      :data-testid="`remove-member-${member.accountId}`"
                      @click="removeMember(member)"
                    >
                      移除
                    </button>
                  </div>
                  <span v-else-if="member.sources.includes('org_inherited')" class="mon-meta">
                    由组织管理
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="mon-hint">当前项目没有可访问人员。</p>
      </template>
    </section>

    <section class="mon-block" data-testid="access-grant">
      <h2 class="mon-title">授予项目成员</h2>
      <div class="mon-grant-form">
        <label class="mon-field">
          组织成员账号
          <input
            type="text"
            v-model="grantAccountId"
            placeholder="accountId"
            data-testid="access-grant-account"
          />
        </label>
        <label class="mon-field">
          角色
          <select v-model="grantRole" data-testid="access-grant-role">
            <option value="project_admin">项目管理员</option>
            <option value="developer">开发成员</option>
            <option value="read_only">只读成员</option>
          </select>
        </label>
        <button
          type="button"
          class="au-button"
          data-testid="access-grant-submit"
          :disabled="grantBusy || grantAccountId.trim() === ''"
          @click="submitGrant"
        >
          {{ grantBusy ? '授予中…' : '授予' }}
        </button>
      </div>
      <p v-if="grantError !== null" class="mon-notice mon-notice--error" role="status">
        {{ grantError }}
      </p>
      <p v-if="actionError !== null" class="mon-notice mon-notice--error" role="status">
        {{ actionError }}
      </p>
    </section>
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
.governance-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-surface);
  background-color: var(--color-surface-bg);
}
.governance-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 720px;
}
.governance-table th,
.governance-table td {
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border-default);
  text-align: left;
  vertical-align: middle;
}
.governance-table th {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.governance-table tbody tr:last-child td {
  border-bottom: 0;
}
.mon-email {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text-primary);
}
.mon-grant-form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: flex-end;
  max-width: 64ch;
}
.mon-field,
.mon-field-inline {
  display: inline-flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-field input,
.mon-field select,
.mon-field-inline select {
  min-height: var(--control-height);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  font: inherit;
}
.mon-actions-row {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
  align-items: center;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.au-button {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-height);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
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
.mon-notice {
  margin: var(--space-2) 0 0;
  color: var(--color-text-secondary);
}
.mon-notice--error {
  color: var(--color-status-danger);
}
</style>
