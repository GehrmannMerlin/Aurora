<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  OPERATION_ID_LIST_MEMBERS,
  OPERATION_ID_LIST_SECURITY_AUDIT,
} from '@aurora/platform-contract';
import { executeQuery } from '../../api/query.js';
import { ApiError } from '../../api/errors.js';
import { describeRequestError } from '../../api/feedback.js';
import { useSessionStore } from '../../stores/session.js';
import AppButton from '../../components/aurora/AppButton.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppSection from '../../components/aurora/AppSection.vue';
import AppSkeleton from '../../components/aurora/AppSkeleton.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import AppTechnicalDetails from '../../components/aurora/AppTechnicalDetails.vue';

type OrgRole = 'owner' | 'admin' | 'member';
type AuditResult = 'succeeded' | 'failed' | 'blocked';

const AUDIT_PAGE_SIZE = 20;

const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  'member.invited': '已邀请成员',
  'member.role_changed': '已更新成员角色',
  'member.removed': '已移除成员',
  'member.invitation_resent': '已重新发送邀请',
  'member.invitation_revoked': '已撤销邀请',
  'organization.ownership_transferred': '已转让组织所有权',
  'project.created': '已创建项目',
  'project.restored': '已恢复项目',
  'private_token.created': '已创建私有令牌',
  'private_token.revoked': '已撤销私有令牌',
};

const AUDIT_RESULT_LABELS: Readonly<Record<AuditResult, string>> = {
  succeeded: '已完成',
  failed: '失败',
  blocked: '已阻止',
};

interface AuditEventSummary {
  readonly eventId: string;
  readonly action: string;
  readonly occurredAt: string;
  readonly result: AuditResult;
  readonly actorMasked: string;
  readonly targetProjectRef?: { readonly projectId: string };
}

interface MemberSummary {
  readonly accountId: string;
  readonly orgRole: OrgRole;
}

interface AuditPage {
  readonly events: readonly AuditEventSummary[];
  readonly pagination: { readonly nextCursor?: string };
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
const canRead = ref(false);

// ---- redacted security timeline ----
const events = ref<readonly AuditEventSummary[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const loadError = ref<string | null>(null);

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
    if (caught.code === 'authorization') return '你没有权限查看该组织的安全审计。';
    if (caught.code === 'not_found') return '组织不存在或你没有访问权限。';
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
    canRead.value = mine?.orgRole === 'owner' || mine?.orgRole === 'admin';
    if (canRead.value) void loadTimeline();
  } catch (caught) {
    canRead.value = false;
    gateError.value = describeLoadError(caught);
  } finally {
    gateLoading.value = false;
  }
}

async function loadTimeline(): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null) return;
  loading.value = true;
  loadError.value = null;
  try {
    const data = await executeQuery<AuditPage>({
      operationId: OPERATION_ID_LIST_SECURITY_AUDIT,
      input: {
        pathParams: { organizationId: orgId },
        query: { limit: AUDIT_PAGE_SIZE },
      },
      scope: { type: 'organization', id: orgId },
    });
    events.value = data.events;
    nextCursor.value = data.pagination.nextCursor ?? null;
  } catch (caught) {
    events.value = [];
    nextCursor.value = null;
    loadError.value = describeLoadError(caught);
  } finally {
    loading.value = false;
  }
}

async function onLoadMore(): Promise<void> {
  const orgId = organizationId.value;
  const cursor = nextCursor.value;
  if (orgId === null || cursor === null || loadingMore.value) return;
  loadingMore.value = true;
  loadError.value = null;
  try {
    const data = await executeQuery<AuditPage>({
      operationId: OPERATION_ID_LIST_SECURITY_AUDIT,
      input: {
        pathParams: { organizationId: orgId },
        query: { limit: AUDIT_PAGE_SIZE, cursor },
      },
      scope: { type: 'organization', id: orgId },
    });
    events.value = [...events.value, ...data.events];
    nextCursor.value = data.pagination.nextCursor ?? null;
  } catch (caught) {
    loadError.value = describeLoadError(caught);
  } finally {
    loadingMore.value = false;
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
    hour12: false,
  }).format(new Date(value));
}

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? '未识别的审计操作';
}
</script>

<template>
  <section class="au-surface" data-testid="audit-view">
    <AppPageHeader title="安全审计" description="以脱敏事实记录组织范围内的安全相关操作。" />

    <AppStatusBadge v-if="gateError !== null" tone="danger" data-testid="audit-gate-error">
      {{ gateError }}
    </AppStatusBadge>

    <p v-else-if="!gateLoading && !canRead" class="au-hint" data-testid="audit-forbidden">
      你没有权限查看该组织的安全审计记录。
    </p>

    <template v-else-if="!gateLoading">
      <AppSection
        title="审计记录"
        description="仅显示操作、时间、结果、脱敏操作者与必要的项目引用；不提供未受契约支持的导出。"
      >
        <AppStatusBadge v-if="loadError !== null" tone="danger" data-testid="audit-error">{{
          loadError
        }}</AppStatusBadge>
        <AppSkeleton
          v-else-if="loading"
          label="正在加载审计记录…"
          :lines="6"
          data-testid="audit-loading"
        />
        <template v-else>
          <ul v-if="events.length > 0" class="au-audit-list" data-testid="audit-list">
            <li
              v-for="event in events"
              :key="event.eventId"
              class="au-audit-item"
              data-testid="audit-row"
            >
              <div class="au-audit-meta">
                <span class="au-audit-action" data-testid="audit-primary-action">{{
                  auditActionLabel(event.action)
                }}</span>
                <AppStatusBadge
                  :tone="
                    event.result === 'succeeded'
                      ? 'success'
                      : event.result === 'failed'
                        ? 'danger'
                        : 'warning'
                  "
                >
                  <span data-testid="audit-primary-result">{{
                    AUDIT_RESULT_LABELS[event.result]
                  }}</span>
                </AppStatusBadge>
                <span class="au-audit-attr" data-testid="audit-timestamp"
                  >UTC · {{ formatDate(event.occurredAt) }}</span
                >
                <span class="au-audit-attr" data-testid="audit-actor">{{ event.actorMasked }}</span>
                <span v-if="event.targetProjectRef !== undefined" class="au-audit-attr">
                  涉及项目
                </span>
                <AppTechnicalDetails summary="技术详情" data-testid="audit-technical-details"
                  >操作键: {{ event.action }} 结果键: {{ event.result }} 时间戳 (UTC):
                  {{ event.occurredAt }}
                  <template v-if="event.targetProjectRef !== undefined"
                    >目标项目 ID: {{ event.targetProjectRef.projectId }}
                  </template>
                  事件 ID: {{ event.eventId }}</AppTechnicalDetails
                >
              </div>
            </li>
          </ul>
          <p v-else class="au-hint">暂无审计记录。</p>

          <AppButton
            v-if="nextCursor !== null"
            variant="secondary"
            :disabled="loadingMore"
            data-testid="audit-load-more"
            @click="onLoadMore"
          >
            {{ loadingMore ? '加载中…' : '加载更多' }}
          </AppButton>
        </template>
      </AppSection>
    </template>
  </section>
</template>

<style scoped>
.au-hint {
  color: var(--color-text-secondary);
  max-width: 64ch;
}
.au-audit-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.au-audit-item {
  display: flex;
  align-items: center;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-border-default);
}
.au-audit-item:last-child {
  border-bottom: 0;
}
.au-audit-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
}
.au-audit-action {
  color: var(--color-text-primary);
  font-weight: 500;
}
.au-audit-attr {
  color: var(--color-text-secondary);
  font-size: 13px;
}
</style>
