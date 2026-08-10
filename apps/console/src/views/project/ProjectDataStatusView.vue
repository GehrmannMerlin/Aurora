<script setup lang="ts">
/**
 * C7 数据接收诊断（`project.data-status`，PLT-05）。
 *
 * 完整呈现 `diagnosticsGetDataStatus`（DAT-20）六个安全投影区。接收状态 ≠
 * 处理状态 ≠ 可查询状态严格分开；HTTP accepted 绝不显示为处理完成。被拒绝批次
 * 未持久化 → `rejection` 恒 `unavailable`；环境维度 deferred → 恒 `unavailable`；
 * 缺失一律不显示为零或“正常”。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import { actionTargetHref, type DiagnosisData } from '../../monitoring/diagnosis.js';
import { formatCount, formatUtc } from '../../monitoring/format.js';
import { fetchDataStatus } from '../../monitoring/queries.js';
import AppLink from '../../components/aurora/AppLink.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';
import { buildDataStatusState, type DataStatusState } from './data-status-view-model.js';

const route = useRoute();
const organizationId = String(route.params.organizationId ?? '');
const projectId = String(route.params.projectId ?? '');

const diagnosis = ref<DiagnosisData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    diagnosis.value = await fetchDataStatus({ organizationId, projectId });
  } catch (caught) {
    diagnosis.value = null;
    error.value = describeRequestError(caught);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

const state = computed<DataStatusState>(() =>
  buildDataStatusState({ loading: loading.value, error: error.value, diagnosis: diagnosis.value }),
);

const actionTargets = computed(() =>
  state.value.actions
    .map((target) => ({ target, href: actionTargetHref(target) }))
    .filter(
      (entry): entry is { target: (typeof state.value.actions)[number]; href: string } =>
        entry.href !== null,
    ),
);
</script>

<template>
  <section class="au-surface" data-testid="project-data-status-view">
    <AppPageHeader title="数据接收诊断" />

    <section class="mon-block" data-testid="ds-summary">
      <h2 class="mon-title">权威诊断摘要</h2>
      <template v-if="state.summary.kind !== 'available'">
        <SectionNotice :view="state.summary" />
      </template>
      <template v-else>
        <AppStatusBadge
          :tone="state.summary.data.status === 'receiving' ? 'success' : 'warning'"
          data-testid="ds-summary-status"
        >
          {{ state.summary.data.status }}
        </AppStatusBadge>
        <p v-if="state.summary.data.primaryCause" class="mon-note">
          原因：{{ state.summary.data.primaryCause }}
        </p>
        <p class="mon-meta">组合时刻：{{ formatUtc(state.summary.data.asOf) }}</p>
      </template>
    </section>

    <section class="mon-block" data-testid="ds-stages">
      <h2 class="mon-title">阶段事实</h2>
      <template v-if="state.stages.kind !== 'available'">
        <SectionNotice :view="state.stages" />
      </template>
      <template v-else>
        <dl class="mon-stages">
          <div class="mon-stage" data-testid="ds-stage-received">
            <dt>已接收</dt>
            <dd class="mon-count">{{ formatCount(state.stages.data.received.count) }}</dd>
            <dd v-if="state.stages.data.received.latestAt" class="mon-meta">
              {{ formatUtc(state.stages.data.received.latestAt) }}
            </dd>
          </div>
          <div class="mon-stage" data-testid="ds-stage-processing">
            <dt>处理中</dt>
            <dd class="mon-count">{{ formatCount(state.stages.data.processing.count) }}</dd>
            <dd v-if="state.stages.data.processing.latestAt" class="mon-meta">
              {{ formatUtc(state.stages.data.processing.latestAt) }}
            </dd>
          </div>
          <div class="mon-stage" data-testid="ds-stage-processed">
            <dt>已处理</dt>
            <dd class="mon-count">{{ formatCount(state.stages.data.processed.count) }}</dd>
            <dd v-if="state.stages.data.processed.latestAt" class="mon-meta">
              {{ formatUtc(state.stages.data.processed.latestAt) }}
            </dd>
          </div>
          <div class="mon-stage" data-testid="ds-stage-deadletter">
            <dt>死信</dt>
            <dd class="mon-count">{{ formatCount(state.stages.data.deadLetter.count) }}</dd>
            <dd v-if="state.stages.data.deadLetter.lastErrorCode" class="mon-meta">
              最近错误：{{ state.stages.data.deadLetter.lastErrorCode }}
            </dd>
          </div>
        </dl>
        <p class="mon-hint">已接收 ≠ 已处理 ≠ 已可查询。</p>
      </template>
    </section>

    <section class="mon-block" data-testid="ds-recent">
      <h2 class="mon-title">最近请求与成功证据</h2>
      <template v-if="state.recent.kind !== 'available'">
        <SectionNotice :view="state.recent" />
      </template>
      <template v-else>
        <dl class="mon-inline">
          <div>
            <dt>最近接收</dt>
            <dd>
              {{ state.recent.data.receivedCount }}
              <span v-if="state.recent.data.latestReceivedAt" class="mon-meta">
                （{{ formatUtc(state.recent.data.latestReceivedAt) }}）
              </span>
            </dd>
          </div>
          <div>
            <dt>最近已处理</dt>
            <dd>
              {{ state.recent.data.processedCount }}
              <span v-if="state.recent.data.latestProcessedAt" class="mon-meta">
                （{{ formatUtc(state.recent.data.latestProcessedAt) }}）
              </span>
            </dd>
          </div>
        </dl>
      </template>
    </section>

    <section class="mon-block" data-testid="ds-rejection">
      <h2 class="mon-title">主要拒绝原因</h2>
      <template v-if="state.rejection.kind !== 'available'">
        <SectionNotice :view="state.rejection" />
      </template>
      <template v-else>
        <p class="mon-hint">无被拒绝批次证据。</p>
      </template>
    </section>

    <section class="mon-block" data-testid="ds-credential">
      <h2 class="mon-title">密钥安全状态</h2>
      <template v-if="state.credential.kind !== 'available'">
        <SectionNotice :view="state.credential" />
      </template>
      <template v-else>
        <dl class="mon-inline">
          <div>
            <dt>激活</dt>
            <dd>{{ formatCount(state.credential.data.activeCount) }}</dd>
          </div>
          <div>
            <dt>停用</dt>
            <dd>{{ formatCount(state.credential.data.disabledCount) }}</dd>
          </div>
          <div>
            <dt>吊销</dt>
            <dd>{{ formatCount(state.credential.data.revokedCount) }}</dd>
          </div>
        </dl>
      </template>
    </section>

    <section class="mon-block" data-testid="ds-queryable">
      <h2 class="mon-title">可查询证据</h2>
      <template v-if="state.queryable.kind !== 'available'">
        <SectionNotice :view="state.queryable" />
      </template>
      <template v-else>
        <dl class="mon-inline">
          <div>
            <dt>错误事件</dt>
            <dd>{{ formatCount(state.queryable.data.errorOccurrences) }}</dd>
          </div>
          <div>
            <dt>请求指标桶</dt>
            <dd>{{ formatCount(state.queryable.data.requestMetricBuckets) }}</dd>
          </div>
          <div>
            <dt>性能指标桶</dt>
            <dd>{{ formatCount(state.queryable.data.performanceMetricBuckets) }}</dd>
          </div>
        </dl>
      </template>
    </section>

    <section v-if="actionTargets.length > 0" class="mon-block" data-testid="ds-actions">
      <h2 class="mon-title">获授权行动目标</h2>
      <ul class="mon-actions">
        <li v-for="entry in actionTargets" :key="entry.href">
          <AppLink :to="entry.href">{{ entry.target.routeId }}</AppLink>
        </li>
      </ul>
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
.mon-note {
  margin: var(--space-1) 0 0;
  color: var(--color-text-secondary);
}
.mon-meta {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-stages {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-3);
  margin: 0;
}
.mon-stage {
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  padding: var(--space-3);
}
.mon-stage dt {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-count {
  margin: var(--space-1) 0 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.mon-inline {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin: 0;
}
.mon-inline dt {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.mon-inline dd {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.mon-hint {
  color: var(--color-text-secondary);
  max-width: 56ch;
}
.mon-actions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
</style>
