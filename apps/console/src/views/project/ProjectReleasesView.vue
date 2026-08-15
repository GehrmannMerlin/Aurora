<script setup lang="ts">
/**
 * C8 发布列表（`project.releases`，PLT-07）。
 *
 * 只消费 `releasesListReleases`（DAT-18）真实投影：SDK 首次上报或获准令牌/CI
 * 创建发布的版本列表。部署记录维度无 v1 Deployment Query，故部署区恒
 * `unavailable` 并说明原因；不显示手工创建发布按钮。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { formatUtc } from '../../monitoring/format.js';
import { fetchReleases, type ReleaseListSection } from '../../monitoring/queries.js';
import { resolveRouteTarget } from '../../contracts/route-registry.js';
import { buildReleasesView, releaseSourceLabel } from './releases-view-model.js';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppLink from '../../components/aurora/AppLink.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';

const route = useRoute();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');
const scope = { organizationId, projectId };

const data = ref<ReleaseListSection | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    data.value = await fetchReleases(scope);
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
  buildReleasesView({
    loading: loading.value,
    error: error.value,
    releases: data.value ?? null,
  }),
);

function releaseHref(releaseId: string): string {
  const resolved = resolveRouteTarget({
    routeId: 'project.release-detail',
    pathParams: { organizationId, projectId, releaseId },
    query: {},
  });
  return resolved.path ?? '/not-found';
}
</script>

<template>
  <section class="au-surface" data-testid="project-releases-view">
    <AppPageHeader title="发布" />

    <div class="delivery-workspace">
      <section class="mon-block delivery-list" data-testid="delivery-list">
        <h2 class="mon-title">发布版本</h2>
        <template v-if="state.list.kind === 'loading'">
          <p class="mon-hint" role="status">正在加载发布列表…</p>
        </template>
        <template v-else-if="state.list.kind === 'error'">
          <SectionNotice :view="state.list" />
        </template>
        <template v-else-if="state.list.kind !== 'available'">
          <SectionNotice :view="state.list" />
          <p class="mon-hint" data-testid="releases-empty-note">
            发布由 SDK 首次上报或获准令牌/CI 创建，管理平台不手工创建发布版本。
          </p>
        </template>
        <template v-else>
          <ul v-if="state.list.data.length > 0" class="mon-release-list" data-testid="release-list">
            <li
              v-for="release in state.list.data"
              :key="release.releaseId"
              class="mon-release-item"
            >
              <div class="mon-release-row">
                <AppLink :to="releaseHref(release.releaseId)" class="mon-release-version">
                  {{ release.version }}
                </AppLink>
                <span class="mon-badge">{{ releaseSourceLabel(release.source) }}</span>
              </div>
              <div class="mon-meta">
                首次出现 {{ formatUtc(release.firstSeenAt) }} · Source Map
                {{ release.sourceMapFileCount }} 个
              </div>
            </li>
          </ul>
          <p v-else class="mon-hint" data-testid="releases-empty-note">
            项目尚无发布版本。发布由 SDK 首次上报或获准令牌/CI 创建。
          </p>
        </template>
      </section>

      <section class="mon-block delivery-detail" data-testid="delivery-detail">
        <div data-testid="releases-deployments">
          <h2 class="mon-title">部署记录</h2>
          <SectionNotice :view="state.deployments" />
        </div>
      </section>
    </div>
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
.mon-release-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.mon-release-item {
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-control);
  padding: var(--space-3);
}
.mon-release-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.mon-release-version {
  font-weight: 600;
  font-size: 15px;
}
.mon-badge {
  display: inline-block;
  padding: 1px var(--space-2);
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-secondary);
  font-size: 12px;
}
.delivery-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(260px, 0.75fr);
  align-items: start;
  gap: var(--space-4);
}
.delivery-list,
.delivery-detail {
  min-width: 0;
}
.delivery-detail {
  border-left: 1px solid var(--color-border-default);
  padding-left: var(--space-4);
}
@media (max-width: 800px) {
  .delivery-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .delivery-detail {
    border-left: 0;
    border-top: 1px solid var(--color-border-default);
    padding: var(--space-4) 0 0;
  }
}
</style>
