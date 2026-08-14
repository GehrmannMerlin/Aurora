<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { OPERATION_ID_CREATE_PROJECT, OPERATION_ID_LIST_PROJECTS } from '@aurora/platform-contract';
import { createIdempotencyKey, platformRequest } from '../../api/client.js';
import { executeQuery } from '../../api/query.js';
import { ApiError } from '../../api/errors.js';
import { describeRequestError } from '../../api/feedback.js';
import { resolveRouteTarget } from '../../contracts/route-registry.js';
import { useNavigationStore } from '../../stores/navigation.js';
import { useSessionStore } from '../../stores/session.js';
import AppButton from '../../components/aurora/AppButton.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppSection from '../../components/aurora/AppSection.vue';
import AppSkeleton from '../../components/aurora/AppSkeleton.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';

const FRAMEWORK_TYPES = ['javascript', 'react', 'vue', 'other'] as const;
type FrameworkType = (typeof FRAMEWORK_TYPES)[number];

interface CreateProjectResult {
  readonly projectId: string;
  readonly clientKeyPublicIdentifier: string;
  readonly clientKey: string;
  readonly defaultEnvironment: string;
}

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const navigation = useNavigationStore();

const organizationId = computed(() => {
  const raw = route.params.organizationId;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
});

// ---- B2 form state ----
const name = ref('');
const frameworkType = ref<FrameworkType>('javascript');
const websiteUrl = ref('');
const creating = ref(false);
const createError = ref<string | null>(null);

// ---- UX-only owner/admin gate (the server re-checks authoritatively). ----
// The create-page contract exposes no allowedActions of its own, so the page
// reads the org project list's allowedActions to decide whether to render the
// form. A member with `read` only sees the forbidden state.
const allowedActions = ref<readonly string[]>([]);
const gateLoading = ref(true);
const gateError = ref<string | null>(null);

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
    const data = await executeQuery<{ allowedActions: readonly string[] }>({
      operationId: OPERATION_ID_LIST_PROJECTS,
      input: { pathParams: { organizationId: orgId } },
      scope: { type: 'organization', id: orgId },
    });
    allowedActions.value = data.allowedActions;
  } catch (caught) {
    allowedActions.value = [];
    gateError.value = describeRequestError(caught);
  } finally {
    gateLoading.value = false;
  }
}

const canCreate = computed(() => allowedActions.value.includes('create'));

const nameError = computed<string | null>(() => {
  const trimmed = name.value.trim();
  if (trimmed.length < 2 || trimmed.length > 50) return '项目名称需为 2–50 个字符。';
  return null;
});

const websiteUrlError = computed<string | null>(() => {
  const trimmed = websiteUrl.value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length < 8 || trimmed.length > 512) return '网站地址需为 8–512 个字符。';
  return null;
});

function describeCreateError(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case 'authorization':
        return '你没有权限在该组织内创建项目。';
      case 'not_found':
        return '组织不存在或你没有访问权限。';
      case 'business_validation':
      case 'idempotency_conflict':
        return '项目创建未能完成，请重试。';
      default:
        return describeRequestError(caught);
    }
  }
  return describeRequestError(caught);
}

function onboardingHref(projectId: string): string {
  const result = resolveRouteTarget({
    routeId: 'project.onboarding',
    pathParams: { organizationId: organizationId.value ?? '', projectId },
    query: {},
  });
  return result.path ?? '/not-found';
}

async function onCreateProject(): Promise<void> {
  const orgId = organizationId.value;
  if (orgId === null || creating.value || session.csrf === null) return;
  if (nameError.value !== null || websiteUrlError.value !== null) return;
  creating.value = true;
  createError.value = null;
  try {
    const body: Record<string, unknown> = {
      name: name.value.trim(),
      frameworkType: frameworkType.value,
      idempotencyKey: createIdempotencyKey(),
    };
    const trimmedUrl = websiteUrl.value.trim();
    if (trimmedUrl.length > 0) body.websiteUrl = trimmedUrl;
    const data = await platformRequest<CreateProjectResult>(
      OPERATION_ID_CREATE_PROJECT,
      { pathParams: { organizationId: orgId }, body },
      { scope: { type: 'organization', id: orgId }, csrf: session.csrf },
    );
    navigation.clear();
    await navigation.load();
    creating.value = false;
    await router.push({
      path: onboardingHref(data.projectId),
      state: {
        clientKey: data.clientKey,
        frameworkType: frameworkType.value,
        environment: data.defaultEnvironment,
      },
    });
  } catch (caught) {
    creating.value = false;
    createError.value = describeCreateError(caught);
  }
}

</script>

<template>
  <section class="au-surface" data-testid="project-create-view">
    <AppPageHeader title="创建项目" description="在当前组织范围内建立一个新的可观测项目。" />

    <AppStatusBadge v-if="gateError !== null" tone="danger" data-testid="create-gate-error">
      {{ gateError }}
    </AppStatusBadge>

    <p v-else-if="!gateLoading && !canCreate" class="au-hint" data-testid="create-forbidden">
      你没有权限在该组织内创建项目。
    </p>

    <AppSkeleton v-else-if="gateLoading" label="正在确认创建权限…" :lines="3" data-testid="create-gate-loading" />

    <template v-else>
      <form class="au-create-form" novalidate @submit.prevent="onCreateProject">
        <AppSection title="基本信息" description="名称用于在组织内识别项目。" test-id="project-basic-section">
          <div class="au-field">
            <label class="au-field__label" for="create-project-name">项目名称</label>
            <input id="create-project-name" class="au-field__input" type="text" :value="name" data-testid="project-name-input" @input="name = ($event.target as HTMLInputElement).value" />
            <p v-if="nameError !== null" class="au-field-error" data-testid="name-error">{{ nameError }}</p>
          </div>
        </AppSection>

        <AppSection title="项目设置" description="选择当前项目使用的框架，并可补充网站地址。" test-id="project-settings-section">
          <div class="au-field">
            <label class="au-field__label" for="create-project-framework">框架类型</label>
            <select id="create-project-framework" class="au-field__input" :value="frameworkType" data-testid="project-framework-select" @change="frameworkType = ($event.target as HTMLSelectElement).value as FrameworkType">
              <option v-for="type in FRAMEWORK_TYPES" :key="type" :value="type">{{ type }}</option>
            </select>
          </div>
          <div class="au-field">
            <label class="au-field__label" for="create-project-website">网站地址（可选）</label>
            <input id="create-project-website" class="au-field__input" type="text" :value="websiteUrl" data-testid="project-website-input" @input="websiteUrl = ($event.target as HTMLInputElement).value" />
            <p v-if="websiteUrlError !== null" class="au-field-error" data-testid="website-error">{{ websiteUrlError }}</p>
          </div>
        </AppSection>

        <AppButton
          type="submit"
          variant="primary"
          :disabled="creating || session.csrf === null || nameError !== null"
          data-testid="create-project-submit"
        >
          {{ creating ? '创建中…' : '创建项目' }}
        </AppButton>

        <AppStatusBadge v-if="createError !== null" tone="danger" data-testid="create-error">
          {{ createError }}
        </AppStatusBadge>
      </form>
    </template>
  </section>
</template>

<style scoped>
.au-hint {
  color: var(--color-text-secondary);
}
.au-create-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 720px;
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
