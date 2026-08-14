<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  OPERATION_ID_CHANGE_ROLE,
  OPERATION_ID_INVITE_MEMBER,
  OPERATION_ID_LIST_MEMBERS,
  OPERATION_ID_REMOVE_MEMBER,
  OPERATION_ID_RESEND_INVITATION,
  OPERATION_ID_REVOKE_INVITATION,
  OPERATION_ID_TRANSFER_OWNERSHIP,
} from '@aurora/platform-contract';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { executeQuery, invalidateScope } from '../../api/query.js';
import { ApiError } from '../../api/errors.js';
import { describeRequestError } from '../../api/feedback.js';
import { useSessionStore } from '../../stores/session.js';
import AppButton from '../../components/aurora/AppButton.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppSection from '../../components/aurora/AppSection.vue';
import AppSkeleton from '../../components/aurora/AppSkeleton.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';

type OrgRole = 'owner' | 'admin' | 'member';

interface MemberSummary {
  readonly accountId: string;
  readonly emailMasked: string;
  readonly orgRole: OrgRole;
  readonly joinedAt?: string;
}

interface PendingInvitation {
  readonly invitationId: string;
  readonly invitedEmailMasked: string;
  readonly expiresAt: string;
  readonly status: 'pending';
}

const route = useRoute();
const session = useSessionStore();

const organizationId = computed(() => {
  const raw = route.params.organizationId;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
});

// ---- member list ----
const members = ref<readonly MemberSummary[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);

// ---- invitations created in this session. The contract has NO list-invitations
// read operation, so the page only shows invites created here (honest, no fake
// history). ----
const invitations = ref<readonly PendingInvitation[]>([]);

// ---- invite form ----
const inviteEmail = ref('');
const inviteRole = ref<'admin' | 'member'>('member');
const inviting = ref(false);
const inviteError = ref<string | null>(null);

// ---- per-account command busy state ----
const busyAccount = ref<string | null>(null);

// ---- ownership transfer ----
const transferTarget = ref<string>('');
const transferring = ref(false);
const transferError = ref<string | null>(null);

const myAccountId = computed(() => session.account?.accountId ?? null);

const myRole = computed<OrgRole | null>(() => {
  const mine =
    myAccountId.value === null
      ? null
      : members.value.find((m) => m.accountId === myAccountId.value);
  return mine?.orgRole ?? null;
});

const canManage = computed(() => myRole.value === 'owner' || myRole.value === 'admin');
const isOwner = computed(() => myRole.value === 'owner');

const transferableMembers = computed(() =>
  members.value.filter((m) => m.accountId !== myAccountId.value),
);

function describeLoadError(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.code === 'authorization') return '你没有权限查看该组织的成员。';
    if (caught.code === 'not_found') return '组织不存在或你没有访问权限。';
  }
  return describeRequestError(caught);
}

function scope() {
  return { type: 'organization' as const, id: organizationId.value ?? '' };
}

async function loadMembers(): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null) {
    members.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  loadError.value = null;
  try {
    const data = await executeQuery<{ members: readonly MemberSummary[] }>({
      operationId: OPERATION_ID_LIST_MEMBERS,
      input: { pathParams: { organizationId: orgId } },
      scope: { type: 'organization', id: orgId },
    });
    members.value = data.members;
  } catch (caught) {
    members.value = [];
    loadError.value = describeLoadError(caught);
  } finally {
    loading.value = false;
  }
}

function describeCommandError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'business_validation':
        return '操作不被允许：该成员是组织所有者或目标状态不允许。';
      case 'version_conflict':
        return '成员信息已变更，请刷新后重试。';
      case 'authorization':
        return '你没有权限执行该操作。';
      default:
        return describeRequestError(caught);
    }
  }
  return describeRequestError(caught);
}

const inviteEmailError = computed<string | null>(() => {
  const email = inviteEmail.value.trim();
  if (email.length < 3 || email.length > 320) return '邮箱地址需为 3–320 个字符。';
  if (!email.includes('@')) return '邮箱地址格式不正确。';
  return null;
});

async function onInvite(): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null || inviting.value || session.csrf === null) return;
  if (inviteEmailError.value !== null) return;
  inviting.value = true;
  inviteError.value = null;
  try {
    const data = await platformRequest<PendingInvitation>(
      OPERATION_ID_INVITE_MEMBER,
      {
        pathParams: { organizationId: orgId },
        body: {
          email: inviteEmail.value.trim(),
          orgRole: inviteRole.value,
          idempotencyKey: createIdempotencyKey(),
        },
      },
      { scope: scope(), csrf: session.csrf },
    );
    invitations.value = [...invitations.value, data];
    inviteEmail.value = '';
    inviteRole.value = 'member';
  } catch (caught) {
    inviteError.value = describeCommandError(caught);
  } finally {
    inviting.value = false;
  }
}

async function onRevokeInvitation(invitationId: string): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null || session.csrf === null) return;
  try {
    await platformRequest(
      OPERATION_ID_REVOKE_INVITATION,
      { pathParams: { organizationId: orgId, invitationId } },
      { scope: scope(), csrf: session.csrf },
    );
    invitations.value = invitations.value.filter((inv) => inv.invitationId !== invitationId);
  } catch (caught) {
    inviteError.value = describeCommandError(caught);
  }
}

async function onResendInvitation(invitationId: string): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null || session.csrf === null) return;
  try {
    const data = await platformRequest<{ status: 'succeeded'; expiresAt: string }>(
      OPERATION_ID_RESEND_INVITATION,
      { pathParams: { organizationId: orgId, invitationId } },
      { scope: scope(), csrf: session.csrf },
    );
    invitations.value = invitations.value.map((inv) =>
      inv.invitationId === invitationId ? { ...inv, expiresAt: data.expiresAt } : inv,
    );
  } catch (caught) {
    inviteError.value = describeCommandError(caught);
  }
}

async function onChangeRole(member: MemberSummary, orgRole: 'admin' | 'member'): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null || session.csrf === null || busyAccount.value !== null) return;
  if (member.orgRole === orgRole) return;
  busyAccount.value = member.accountId;
  try {
    await platformRequest(
      OPERATION_ID_CHANGE_ROLE,
      {
        pathParams: { organizationId: orgId, accountId: member.accountId },
        body: { orgRole, resourceVersion: '0' },
      },
      { scope: scope(), csrf: session.csrf },
    );
    members.value = members.value.map((m) =>
      m.accountId === member.accountId ? { ...m, orgRole } : m,
    );
  } catch (caught) {
    loadError.value = describeCommandError(caught);
  } finally {
    busyAccount.value = null;
  }
}

async function onRemoveMember(member: MemberSummary): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null || session.csrf === null || busyAccount.value !== null) return;
  busyAccount.value = member.accountId;
  try {
    await platformRequest(
      OPERATION_ID_REMOVE_MEMBER,
      {
        pathParams: { organizationId: orgId, accountId: member.accountId },
        body: { resourceVersion: '0' },
      },
      { scope: scope(), csrf: session.csrf },
    );
    members.value = members.value.filter((m) => m.accountId !== member.accountId);
  } catch (caught) {
    loadError.value = describeCommandError(caught);
  } finally {
    busyAccount.value = null;
  }
}

async function onTransferOwnership(): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null || session.csrf === null || transferring.value) return;
  if (transferTarget.value.length === 0) return;
  transferring.value = true;
  transferError.value = null;
  try {
    await platformRequest(
      OPERATION_ID_TRANSFER_OWNERSHIP,
      {
        pathParams: { organizationId: orgId },
        body: { newOwnerAccountId: transferTarget.value, idempotencyKey: createIdempotencyKey() },
      },
      { scope: scope(), csrf: session.csrf },
    );
    // Roles changed globally; reload the authoritative list.
    invalidateScope({ type: 'organization', id: orgId });
    transferTarget.value = '';
    await loadMembers();
  } catch (caught) {
    transferError.value = describeCommandError(caught);
  } finally {
    transferring.value = false;
  }
}

onMounted(() => {
  void loadMembers();
});
</script>

<template>
  <section class="au-surface" data-testid="members-view">
    <AppPageHeader title="成员" description="查看组织成员，并在具备权限时管理邀请和角色。" />

    <AppStatusBadge v-if="loadError !== null" tone="danger" data-testid="members-error">
      {{ loadError }}
    </AppStatusBadge>

    <AppSkeleton v-else-if="loading" label="正在加载成员…" :lines="4" data-testid="members-loading" />

    <template v-else>
      <AppSection title="成员列表" description="电子邮箱以脱敏形式显示。">
        <ul v-if="members.length > 0" class="au-member-list" data-testid="member-list">
          <li
            v-for="member in members"
            :key="member.accountId"
            class="au-member-item"
            data-testid="member-row"
          >
            <span class="au-member-email" data-testid="member-email">{{ member.emailMasked }}</span>
            <AppStatusBadge :tone="member.orgRole === 'owner' ? 'success' : 'neutral'">
              {{ member.orgRole }}
            </AppStatusBadge>
            <span v-if="member.accountId === myAccountId" class="au-member-self">（我）</span>
            <span
              v-if="canManage && member.accountId !== myAccountId && member.orgRole !== 'owner'"
              class="au-member-actions"
            >
              <AppButton
                variant="secondary"
                :disabled="busyAccount === member.accountId"
                :data-testid="`change-role-${member.accountId}`"
                @click="onChangeRole(member, member.orgRole === 'admin' ? 'member' : 'admin')"
              >
                {{ member.orgRole === 'admin' ? '设为成员' : '设为管理员' }}
              </AppButton>
              <AppButton
                variant="danger"
                :disabled="busyAccount === member.accountId"
                :data-testid="`remove-member-${member.accountId}`"
                @click="onRemoveMember(member)"
              >
                移除
              </AppButton>
            </span>
          </li>
        </ul>
        <p v-else class="au-hint">暂无成员。</p>
      </AppSection>

      <AppSection v-if="canManage" title="邀请成员" description="邀请仅在当前会话内列出，服务端会再次确认权限。" data-testid="members-manage">
        <form class="au-form" novalidate @submit.prevent="onInvite">
          <div class="au-field">
            <label class="au-field__label" for="invite-email">邮箱</label>
            <input
              id="invite-email"
              class="au-field__input"
              type="text"
              :value="inviteEmail"
              data-testid="invite-email-input"
              @input="inviteEmail = ($event.target as HTMLInputElement).value"
            />
            <p
              v-if="inviteEmailError !== null"
              class="au-field-error"
              data-testid="invite-email-error"
            >
              {{ inviteEmailError }}
            </p>
          </div>
          <div class="au-field">
            <label class="au-field__label" for="invite-role">角色</label>
            <select
              id="invite-role"
              class="au-field__input"
              :value="inviteRole"
              data-testid="invite-role-select"
              @change="
                inviteRole = ($event.target as HTMLSelectElement).value as 'admin' | 'member'
              "
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <AppButton
            type="submit"
            variant="primary"
            :disabled="inviting || session.csrf === null || inviteEmailError !== null"
            data-testid="invite-submit"
          >
            {{ inviting ? '邀请中…' : '发送邀请' }}
          </AppButton>
          <AppStatusBadge v-if="inviteError !== null" tone="danger" data-testid="invite-error">
            {{ inviteError }}
          </AppStatusBadge>
        </form>

        <h3 class="au-section-subtitle">本会话创建的邀请</h3>
        <ul v-if="invitations.length > 0" class="au-invitation-list" data-testid="invitation-list">
          <li
            v-for="invitation in invitations"
            :key="invitation.invitationId"
            class="au-member-item"
            data-testid="invitation-row"
          >
            <span class="au-member-email">{{ invitation.invitedEmailMasked }}</span>
            <AppStatusBadge tone="neutral">{{ invitation.status }}</AppStatusBadge>
            <span class="au-invitation-expires">过期时间 {{ invitation.expiresAt }}</span>
            <span class="au-member-actions">
              <AppButton
                variant="secondary"
                data-testid="resend-invitation"
                @click="onResendInvitation(invitation.invitationId)"
              >
                重新发送
              </AppButton>
              <AppButton
                variant="danger"
                data-testid="revoke-invitation"
                @click="onRevokeInvitation(invitation.invitationId)"
              >
                撤销
              </AppButton>
            </span>
          </li>
        </ul>
        <p v-else class="au-hint">本会话尚未创建邀请。</p>
      </AppSection>

      <AppSection
        v-if="isOwner && transferableMembers.length > 0"
        title="转让所有权"
        description="此操作会影响组织的管理权限。"
        data-testid="transfer-ownership"
      >
        <form class="au-form" novalidate @submit.prevent="onTransferOwnership">
          <div class="au-field">
            <label class="au-field__label" for="transfer-target">新所有者</label>
            <select
              id="transfer-target"
              class="au-field__input"
              :value="transferTarget"
              data-testid="transfer-target-select"
              @change="transferTarget = ($event.target as HTMLSelectElement).value"
            >
              <option value="" disabled>请选择成员</option>
              <option
                v-for="member in transferableMembers"
                :key="member.accountId"
                :value="member.accountId"
              >
                {{ member.emailMasked }}
              </option>
            </select>
          </div>
          <AppButton
            type="submit"
            variant="danger"
            :disabled="transferring || session.csrf === null || transferTarget.length === 0"
            data-testid="transfer-submit"
          >
            {{ transferring ? '转让中…' : '转让所有权' }}
          </AppButton>
          <AppStatusBadge v-if="transferError !== null" tone="danger" data-testid="transfer-error">
            {{ transferError }}
          </AppStatusBadge>
        </form>
      </AppSection>
    </template>
  </section>
</template>

<style scoped>
.au-hint {
  color: var(--color-text-secondary);
}
.au-section {
  margin-bottom: var(--space-6);
}
.au-section-subtitle {
  margin: var(--space-4) 0 var(--space-2);
  font-size: 14px;
  color: var(--color-text-secondary);
}
.au-member-list,
.au-invitation-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.au-member-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.au-member-email {
  color: var(--color-text-primary);
}
.au-member-self {
  color: var(--color-text-secondary);
  font-size: 13px;
}
.au-member-actions {
  display: inline-flex;
  gap: var(--space-2);
  margin-left: auto;
}
.au-invitation-expires {
  color: var(--color-text-secondary);
  font-size: 13px;
}
.au-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 42ch;
  margin-bottom: var(--space-4);
}
.au-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.au-field__label {
  color: var(--color-text-primary);
  font-weight: 500;
}
.au-field__input {
  height: var(--control-height);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  font: inherit;
}
.au-field-error {
  margin: 0;
  color: var(--color-status-danger);
  font-size: 13px;
}
</style>
