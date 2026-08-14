<script setup lang="ts">
/**
 * C8 发布详情（`project.release-detail`，PLT-07）。
 *
 * 从 `releasesListReleases` 解析当前发布身份并展示发布上下文，内嵌
 * `ProjectSourceMapsView`（C9）作为该发布的 Source Map 工作区。发布身份
 * 由服务端权威返回；部署记录维度无 v1 Deployment Query，恒 unavailable。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { formatUtc } from '../../monitoring/format.js';
import { fetchReleases, type ReleaseSummary } from '../../monitoring/queries.js';
import { resolveRouteTarget } from '../../contracts/route-registry.js';
import { releaseSourceLabel } from './releases-view-model.js';
import ProjectSourceMapsView from './ProjectSourceMapsView.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppLink from '../../components/aurora/AppLink.vue';

const route = useRoute();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const releaseId = String(route.params.releaseId ?? '');
const scope = { organizationId, projectId };

const releases = ref<readonly ReleaseSummary[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const currentRelease = computed<ReleaseSummary | null>(
  () => releases.value.find((release) => release.releaseId === releaseId) ?? null,
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const data = await fetchReleases(scope);
    if (data.status === 'available') {
      releases.value = data.data.items;
    }
  } catch (caught) {
    error.value = describeRequestError(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

function backHref(): string {
  const resolved = resolveRouteTarget({
    routeId: 'project.releases',
    pathParams: { organizationId, projectId },
    query: {},
  });
  return resolved.path ?? '/not-found';
}

const releaseVersionText = computed<string>(() => {
  if (loading.value) return '正在加载发布…';
  if (error.value !== null) return releaseId;
  return currentRelease.value?.version ?? releaseId;
});
</script>

<template>
  <section class="au-surface" data-testid="project-release-detail-view">
    <AppPageHeader title="发布详情" />
    <p class="mon-meta">
      <AppLink :to="backHref()">返回发布列表</AppLink>
    </p>

    <section class="mon-block" data-testid="release-detail-identity">
      <h2 class="mon-title">发布身份</h2>
      <template v-if="currentRelease !== null">
        <p class="mon-version">{{ currentRelease.version }}</p>
        <p class="mon-meta">
          {{ releaseSourceLabel(currentRelease.source) }} · 首次出现
          {{ formatUtc(currentRelease.firstSeenAt) }}
        </p>
      </template>
      <template v-else>
        <p class="mon-hint">{{ releaseVersionText }}</p>
      </template>
    </section>

    <section class="release-detail-evidence" data-testid="release-detail-evidence">
      <ProjectSourceMapsView />
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
.mon-version {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.release-detail-evidence {
  border-top: 1px solid var(--color-border-default);
  padding-top: var(--space-4);
}
</style>
