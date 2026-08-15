<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { OPERATION_ID_LIST_MEMBERS, OPERATION_ID_UPDATE_TIMEZONE } from '@aurora/platform-contract';
import { platformRequest } from '../../api/client.js';
import { executeQuery } from '../../api/query.js';
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
  readonly orgRole: OrgRole;
}

const COMMON_TIMEZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Australia/Perth',
  'Pacific/Auckland',
] as const;

const route = useRoute();
const session = useSessionStore();

const organizationId = computed(() => {
  const raw = route.params.organizationId;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
});

// ---- UX-only owner/admin gate (the server re-checks authoritatively). The
// settings update requires an org manager, so a plain member sees a forbidden
// state instead of a form that would 403 on submit. ----
const gateLoading = ref(true);
const gateError = ref<string | null>(null);
const canManage = ref(false);

const myAccountId = computed(() => session.account?.accountId ?? null);

watch(
  organizationId,
  () => {
    void loadGate();
  },
  { immediate: true },
);

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
  } catch (caught) {
    canManage.value = false;
    gateError.value = describeRequestError(caught);
  } finally {
    gateLoading.value = false;
  }
}

// ---- B4 timezone form. The contract has NO read-settings operation, so the
// page cannot show the server's current timezone or version; it only submits.
// The update response carries the new resourceVersion, which is tracked so a
// subsequent submit stays optimistic-concurrency-valid. ----
const timezone = ref('');
const resourceVersion = ref('0');
const updating = ref(false);
const updateError = ref<string | null>(null);
const updateInfo = ref<string | null>(null);
const lastSavedTimezone = ref<string | null>(null);

const timezoneError = computed<string | null>(() => {
  const value = timezone.value.trim();
  if (value.length < 1 || value.length > 64) return '时区标识需为 1–64 个字符。';
  try {
    // Validates a real IANA time zone id (throws RangeError for unknown zones).
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return null;
  } catch {
    return '未知的 IANA 时区标识。';
  }
});

function describeUpdateError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'version_conflict':
        return '组织设置已被其他操作更新，版本已刷新，请重新提交。';
      case 'authorization':
        return '你没有权限修改该组织的设置。';
      case 'not_found':
        return '组织不存在或你没有访问权限。';
      case 'field_validation':
      case 'structural_error':
        return '时区标识不符合要求。';
      default:
        return describeRequestError(caught);
    }
  }
  return describeRequestError(caught);
}

/** Recover the server's current settings version from the 412 problem's
 *  fieldErrors (the platform-api returns it there for exactly this recovery). */
function currentVersionFromError(error: ApiError): string | null {
  const field = error.fieldErrors?.find((entry) => entry.field === 'resourceVersion');
  if (field === undefined) return null;
  const match = /Current version is (\d+)/.exec(field.reason);
  return match === null ? null : (match[1] ?? null);
}

async function onUpdateTimezone(): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null || updating.value || session.csrf === null) return;
  if (timezoneError.value !== null) return;
  updating.value = true;
  updateError.value = null;
  updateInfo.value = null;
  try {
    const data = await platformRequest<{ timezone: string; resourceVersion: string }>(
      OPERATION_ID_UPDATE_TIMEZONE,
      {
        pathParams: { organizationId: orgId },
        body: { timezone: timezone.value.trim(), resourceVersion: resourceVersion.value },
      },
      { scope: { type: 'organization', id: orgId }, csrf: session.csrf },
    );
    resourceVersion.value = data.resourceVersion;
    lastSavedTimezone.value = data.timezone;
    updateInfo.value = '组织时区已更新。';
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === 'version_conflict') {
      const recovered = currentVersionFromError(caught);
      if (recovered !== null) resourceVersion.value = recovered;
    }
    updateError.value = describeUpdateError(caught);
  } finally {
    updating.value = false;
  }
}
</script>

<template>
  <section class="au-surface" data-testid="settings-view">
    <AppPageHeader title="组织设置" description="维护组织级统计口径所需的基础配置。" />

    <AppStatusBadge v-if="gateError !== null" tone="danger" data-testid="settings-gate-error">
      {{ gateError }}
    </AppStatusBadge>

    <p v-else-if="!gateLoading && !canManage" class="au-hint" data-testid="settings-forbidden">
      你没有权限修改该组织的设置。
    </p>

    <AppSkeleton
      v-else-if="gateLoading"
      label="正在确认设置权限…"
      :lines="3"
      data-testid="settings-gate-loading"
    />

    <AppSection
      v-else
      title="统计设置"
      description="组织业务时区用于数据统计口径。当前时区与版本无法读取，修改后以提交结果为准。"
      data-testid="organization-settings-section"
    >
      <p v-if="lastSavedTimezone !== null" class="au-hint" data-testid="current-timezone">
        当前保存的时区：{{ lastSavedTimezone }}
      </p>
      <form class="au-form" novalidate @submit.prevent="onUpdateTimezone">
        <div class="au-field">
          <label class="au-field__label" for="settings-timezone">时区（IANA 标识）</label>
          <input
            id="settings-timezone"
            class="au-field__input"
            type="text"
            list="common-timezones"
            :value="timezone"
            placeholder="例如 Asia/Shanghai"
            data-testid="timezone-input"
            @input="timezone = ($event.target as HTMLInputElement).value"
          />
          <datalist id="common-timezones">
            <option v-for="zone in COMMON_TIMEZONES" :key="zone" :value="zone" />
          </datalist>
          <p v-if="timezoneError !== null" class="au-field-error" data-testid="timezone-error">
            {{ timezoneError }}
          </p>
        </div>

        <AppButton
          type="submit"
          variant="primary"
          :disabled="updating || session.csrf === null || timezoneError !== null"
          data-testid="timezone-submit"
        >
          {{ updating ? '保存中…' : '保存时区' }}
        </AppButton>

        <AppStatusBadge v-if="updateInfo !== null" tone="success" data-testid="timezone-success">
          {{ updateInfo }}
        </AppStatusBadge>
        <AppStatusBadge
          v-if="updateError !== null"
          tone="danger"
          data-testid="timezone-error-banner"
        >
          {{ updateError }}
        </AppStatusBadge>
      </form>
    </AppSection>
  </section>
</template>

<style scoped>
.au-hint {
  color: var(--color-text-secondary);
  max-width: 64ch;
}
.au-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 720px;
  margin-top: var(--space-4);
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
  border-radius: var(--radius-control);
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
