<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  OPERATION_ID_LIST_MEMBERS,
  OPERATION_ID_LIST_TRASH,
  OPERATION_ID_RESTORE_PROJECT,
} from '@aurora/platform-contract';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { executeQuery, invalidateScope } from '../../api/query.js';
import { ApiError } from '../../api/errors.js';
import { describeRequestError } from '../../api/feedback.js';
import { useSessionStore } from '../../stores/session.js';
import AppButton from '../../components/aurora/AppButton.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';

type OrgRole = 'owner' | 'admin' | 'member';
type FrameworkType = 'javascript' | 'react' | 'vue' | 'other';

interface TrashedProjectSummary {
  readonly projectId: string;
  readonly name: string;
  readonly frameworkType: FrameworkType;
  readonly trashedAt: string;
  readonly recoverableUntil: string;
  readonly lifecycle: 'trash';
}

interface MemberSummary {
  readonly accountId: string;
  readonly orgRole: OrgRole;
}

const route = useRoute();
const session = useSessionStore();

const organizationId = computed(() => {
  const raw = route.params.organizationId;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
});

// ---- UX-only owner/admin gate (the server re-checks authoritatively). ----
const gateLoading = ref(true);
const gateError = ref<string | null>(null);
const canManage = ref(false);

// ---- trash list ----
const projects = ref<readonly TrashedProjectSummary[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);

// ---- restore ----
// The trash list does NOT expose the project's current resourceVersion, so the
// page uses `trashedAt` (a valid ISO timestamp the server accepts) as an
// optimistic version and recovers the true current version from a 412
// version_conflict problem's fieldErrors (`Current version is N.`), then
// auto-resubmits once.
const versionByProject = ref<Readonly<Record<string, string>>>({});
const restoringId = ref<string | null>(null);
const restoreError = ref<string | null>(null);
const restoreInfo = ref<string | null>(null);

const myAccountId = computed(() => session.account?.accountId ?? null);

watch(
  organizationId,
  () => {
    void loadGate();
  },
  { immediate: true },
);

function describeLoadError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.code === 'authorization') return '你没有权限查看该组织的回收站。';
    if (caught.code === 'not_found') return '组织不存在或你没有访问权限。';
  }
  return describeRequestError(caught);
}

function describeRestoreError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'authorization':
        return '你没有权限恢复该项目。';
      case 'not_found':
        return '项目不存在或不属于该组织。';
      case 'state_machine_conflict':
        return '项目已不在可恢复状态（可能已过恢复窗口或被清理）。';
      case 'version_conflict':
        return '项目版本已变更，请重试。';
      case 'idempotency_conflict':
        return '恢复请求冲突，请重试。';
      default:
        return describeRequestError(caught);
    }
  }
  return describeRequestError(caught);
}

async function loadGate(): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null) {
    gateLoading.value = false;
    return;
  }
  gateLoading.value = true;
  gateError.value = null;
  try {
    const data = await executeQuery<{ members: readonly MemberSummary[] }>({
      operationId: OPERATION_ID_LIST_MEMBERS,
      input: { pathParams: { organizationId: orgId } },
      scope: { type: 'organization', id: orgId },
    });
    const mine = data.members.find((member) => member.accountId === myAccountId.value);
    canManage.value = mine?.orgRole === 'owner' || mine?.orgRole === 'admin';
    if (canManage.value) void loadTrash();
  } catch (caught) {
    canManage.value = false;
    gateError.value = describeLoadError(caught);
  } finally {
    gateLoading.value = false;
  }
}

async function loadTrash(): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null) return;
  loading.value = true;
  loadError.value = null;
  try {
    const data = await executeQuery<{ projects: readonly TrashedProjectSummary[] }>({
      operationId: OPERATION_ID_LIST_TRASH,
      input: { pathParams: { organizationId: orgId } },
      scope: { type: 'organization', id: orgId },
    });
    projects.value = data.projects;
  } catch (caught) {
    projects.value = [];
    loadError.value = describeLoadError(caught);
  } finally {
    loading.value = false;
  }
}

async function onRestoreProject(project: TrashedProjectSummary): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null || session.csrf === null || restoringId.value !== null) return;
  restoringId.value = project.projectId;
  restoreError.value = null;
  restoreInfo.value = null;
  try {
    await restoreOnce(project, 0);
  } catch (caught) {
    restoreError.value = describeRestoreError(caught);
  } finally {
    restoringId.value = null;
  }
}

/** Recover the server's current resourceVersion from the 412 problem's
 *  fieldErrors (the platform-api returns it there for exactly this recovery).
 *  The reason text is `Current version is <iso>.` — the trailing period belongs
 *  to the sentence, not the version. */
function currentVersionFromError(error: ApiError): string | null {
  const field = error.fieldErrors?.find((entry) => entry.field === 'resourceVersion');
  if (field === undefined) return null;
  const match = /Current version is (\S+)/.exec(field.reason);
  if (match === null) return null;
  const version = match[1] ?? null;
  return version === null ? null : version.replace(/\.$/, '');
}

async function restoreOnce(project: TrashedProjectSummary, attempt: number): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null || session.csrf === null) return;
  const resourceVersion = versionByProject.value[project.projectId] ?? project.trashedAt;
  try {
    const data = await platformRequest<{ status: 'active' }>(
      OPERATION_ID_RESTORE_PROJECT,
      {
        pathParams: { organizationId: orgId, projectId: project.projectId },
        body: { resourceVersion, idempotencyKey: createIdempotencyKey() },
      },
      { scope: { type: 'organization', id: orgId }, csrf: session.csrf },
    );
    if (data.status === 'active') {
      projects.value = projects.value.filter((candidate) => candidate.projectId !== project.projectId);
      invalidateScope({ type: 'organization', id: orgId });
      restoreInfo.value = `项目「${project.name}」已恢复。`;
    }
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === 'version_conflict' && attempt < 1) {
      const recovered = currentVersionFromError(caught);
      if (recovered !== null) {
        versionByProject.value = { ...versionByProject.value, [project.projectId]: recovered };
        return restoreOnce(project, attempt + 1);
      }
    }
    throw caught;
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
</script>

<template>
  <section class="au-surface" data-testid="trash-view">
    <AppPageHeader title="回收站" />

    <AppStatusBadge v-if="gateError !== null" tone="danger" data-testid="trash-gate-error">
      {{ gateError }}
    </AppStatusBadge>

    <p v-else-if="!gateLoading && !canManage" class="au-hint" data-testid="trash-forbidden">
      你没有权限管理该组织的回收站。
    </p>

    <template v-else-if="!gateLoading">
      <p class="au-hint" data-testid="trash-safety-note">
        回收站遵循平台安全规则：仅可恢复回收窗口内的项目本体；告警规则、已被吊销的令牌和已禁用的客户端密钥不会被恢复。
      </p>

      <AppStatusBadge v-if="loadError !== null" tone="danger" data-testid="trash-error">
        {{ loadError }}
      </AppStatusBadge>

      <p v-else-if="loading" class="au-hint" role="status" data-testid="trash-loading">
        正在加载回收站…
      </p>

      <template v-else>
        <section class="au-section">
          <h2 class="au-section-title">可恢复项目</h2>
          <ul v-if="projects.length > 0" class="au-trash-list" data-testid="trash-list">
            <li
              v-for="project in projects"
              :key="project.projectId"
              class="au-trash-item"
              data-testid="trash-row"
            >
              <div class="au-trash-meta">
                <span class="au-trash-name" data-testid="trash-name">{{ project.name }}</span>
                <span class="au-trash-attr">{{ project.frameworkType }}</span>
                <span class="au-trash-attr">回收 {{ formatDate(project.trashedAt) }}</span>
                <span class="au-trash-attr">可恢复至 {{ formatDate(project.recoverableUntil) }}</span>
              </div>
              <AppButton
                variant="primary"
                :disabled="restoringId === project.projectId"
                :data-testid="`restore-project-${project.projectId}`"
                @click="onRestoreProject(project)"
              >
                {{ restoringId === project.projectId ? '恢复中…' : '恢复' }}
              </AppButton>
            </li>
          </ul>
          <p v-else class="au-hint">回收站为空。</p>
        </section>

        <AppStatusBadge v-if="restoreInfo !== null" tone="success" data-testid="trash-restore-success">
          {{ restoreInfo }}
        </AppStatusBadge>
        <AppStatusBadge v-if="restoreError !== null" tone="danger" data-testid="trash-restore-error">
          {{ restoreError }}
        </AppStatusBadge>
      </template>
    </template>
  </section>
</template>

<style scoped>
.au-hint {
  color: var(--color-text-secondary);
  max-width: 64ch;
}
.au-section {
  margin-bottom: var(--space-4);
}
.au-section-title {
  margin: 0 0 var(--space-3);
  font-size: 16px;
  color: var(--color-text-primary);
}
.au-trash-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.au-trash-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.au-trash-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
}
.au-trash-name {
  color: var(--color-text-primary);
  font-weight: 500;
}
.au-trash-attr {
  color: var(--color-text-secondary);
  font-size: 13px;
}
</style>
