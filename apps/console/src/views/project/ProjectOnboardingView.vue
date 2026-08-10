<script setup lang="ts">
/**
 * C1 项目接入（`project.onboarding`，PLT-05）。
 *
 * 第一层接入链状态全部来自 `diagnosticsGetDataStatus`（DAT-20）服务端组合的
 * `summary`/`stages`/`credential`/`queryable`/`actionTargets`。`received ≠
 * processed ≠ queryable` 严格分开；HTTP accepted 绝不显示为处理完成。PRD
 * §4.4.6 接入枚举（connected/connection_error/not_started）依赖未提供的后端
 * 能力，本页不伪造；三步引导只呈现 PRD 已批准的说明性内容并诚实标注能力缺口。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { describeRequestError } from '../../api/feedback.js';
import {
  actionTargetHref,
  type DiagnosisData,
  type StageFacts,
} from '../../monitoring/diagnosis.js';
import { formatCount, formatUtc } from '../../monitoring/format.js';
import { fetchDataStatus } from '../../monitoring/queries.js';
import { toSectionView } from '../../monitoring/section.js';
import AppLink from '../../components/aurora/AppLink.vue';
import AppPageHeader from '../../components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../components/aurora/AppStatusBadge.vue';
import SectionNotice from '../../components/monitoring/SectionNotice.vue';
import { onboardingStatusLine } from './onboarding-view-model.js';

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

const summaryView = computed(() =>
  toSectionView({
    loading: loading.value,
    error: error.value,
    section: diagnosis.value?.summary ?? null,
  }),
);
const stagesView = computed(() =>
  toSectionView<StageFacts>({
    loading: loading.value,
    error: error.value,
    section: diagnosis.value?.stages ?? null,
  }),
);
const credentialView = computed(() =>
  toSectionView({
    loading: loading.value,
    error: error.value,
    section: diagnosis.value?.credential ?? null,
  }),
);
const queryableView = computed(() =>
  toSectionView({
    loading: loading.value,
    error: error.value,
    section: diagnosis.value?.queryable ?? null,
  }),
);

const statusLine = computed(() => {
  if (summaryView.value.kind === 'available') return onboardingStatusLine(summaryView.value.data);
  return null;
});

const actionTargets = computed(() => {
  const targets = diagnosis.value?.actionTargets ?? [];
  return targets
    .map((target) => ({ target, href: actionTargetHref(target) }))
    .filter(
      (entry): entry is { target: (typeof targets)[number]; href: string } => entry.href !== null,
    );
});

function onRecheck(): void {
  void load();
}
</script>

<template>
  <section class="au-surface" data-testid="project-onboarding-view">
    <AppPageHeader title="项目接入" />

    <div class="mon-status" data-testid="onboarding-status">
      <template v-if="statusLine !== null">
        <AppStatusBadge :tone="statusLine.tone">{{ statusLine.label }}</AppStatusBadge>
        <p v-if="statusLine.note" class="mon-note">{{ statusLine.note }}</p>
      </template>
      <SectionNotice v-else :view="summaryView" />
    </div>

    <section class="mon-block" data-testid="onboarding-stages">
      <h2 class="mon-title">接入阶段事实</h2>
      <template v-if="stagesView.kind !== 'available'">
        <SectionNotice :view="stagesView" />
      </template>
      <dl v-else class="mon-stages">
        <div class="mon-stage">
          <dt>已接收（可靠缓冲）</dt>
          <dd class="mon-count">{{ formatCount(stagesView.data.received.count) }}</dd>
          <dd v-if="stagesView.data.received.latestAt" class="mon-meta">
            {{ formatUtc(stagesView.data.received.latestAt) }}
          </dd>
        </div>
        <div class="mon-stage">
          <dt>处理中（pending/leased/retry）</dt>
          <dd class="mon-count">{{ formatCount(stagesView.data.processing.count) }}</dd>
          <dd v-if="stagesView.data.processing.latestAt" class="mon-meta">
            {{ formatUtc(stagesView.data.processing.latestAt) }}
          </dd>
        </div>
        <div class="mon-stage">
          <dt>已处理（processed）</dt>
          <dd class="mon-count">{{ formatCount(stagesView.data.processed.count) }}</dd>
          <dd v-if="stagesView.data.processed.latestAt" class="mon-meta">
            {{ formatUtc(stagesView.data.processed.latestAt) }}
          </dd>
        </div>
        <div class="mon-stage">
          <dt>死信（dead letter）</dt>
          <dd class="mon-count">{{ formatCount(stagesView.data.deadLetter.count) }}</dd>
          <dd v-if="stagesView.data.deadLetter.lastErrorCode" class="mon-meta">
            最近错误：{{ stagesView.data.deadLetter.lastErrorCode }}
          </dd>
        </div>
      </dl>
      <p class="mon-hint">
        已接收 ≠ 已处理 ≠ 已可查询：只有进入 processing-store 的证据才算可查询。
      </p>
    </section>

    <section class="mon-block" data-testid="onboarding-credential">
      <h2 class="mon-title">上报密钥</h2>
      <template v-if="credentialView.kind !== 'available'">
        <SectionNotice :view="credentialView" />
      </template>
      <dl v-else class="mon-inline">
        <div>
          <dt>激活</dt>
          <dd>{{ formatCount(credentialView.data.activeCount) }}</dd>
        </div>
        <div>
          <dt>停用</dt>
          <dd>{{ formatCount(credentialView.data.disabledCount) }}</dd>
        </div>
        <div>
          <dt>吊销</dt>
          <dd>{{ formatCount(credentialView.data.revokedCount) }}</dd>
        </div>
      </dl>
    </section>

    <section class="mon-block" data-testid="onboarding-queryable">
      <h2 class="mon-title">可查询证据</h2>
      <template v-if="queryableView.kind !== 'available'">
        <SectionNotice :view="queryableView" />
      </template>
      <dl v-else class="mon-inline">
        <div>
          <dt>错误事件</dt>
          <dd>{{ formatCount(queryableView.data.errorOccurrences) }}</dd>
        </div>
        <div>
          <dt>请求指标桶</dt>
          <dd>{{ formatCount(queryableView.data.requestMetricBuckets) }}</dd>
        </div>
        <div>
          <dt>性能指标桶</dt>
          <dd>{{ formatCount(queryableView.data.performanceMetricBuckets) }}</dd>
        </div>
      </dl>
    </section>

    <section v-if="actionTargets.length > 0" class="mon-block" data-testid="onboarding-actions">
      <h2 class="mon-title">下一步</h2>
      <ul class="mon-actions">
        <li v-for="entry in actionTargets" :key="entry.href">
          <AppLink :to="entry.href">{{ entry.target.routeId }}</AppLink>
        </li>
      </ul>
    </section>

    <section class="mon-block mon-guide" data-testid="onboarding-guide">
      <h2 class="mon-title">接入引导</h2>
      <ol class="mon-steps">
        <li>
          <h3>1. 安装 SDK</h3>
          <p class="mon-hint">
            安装命令需由版本化模板契约提供，该能力尚未提供；不会在此生成猜测的版本命令。
          </p>
        </li>
        <li>
          <h3>2. 初始化 SDK</h3>
          <p class="mon-hint">
            初始化代码使用当前项目的客户端上报密钥与运行环境。真实密钥投影尚未提供，下方为 PRD
            批准的示例结构：
          </p>
          <pre class="mon-code"><code>import {{ '{' }} Aurora {{ '}' }} from "@aurora/browser";

Aurora.init({{ '{' }}
  clientKey: "（未提供：密钥投影能力尚未开放）",
  environment: "production"
{{ '}' }});</code></pre>
        </li>
        <li>
          <h3>3. 发送测试错误</h3>
          <p class="mon-hint">
            测试错误发送后需完成接收、校验、存储并聚合为问题才算接入成功；测试事件状态查询尚未
            提供，因此不会声称“接入成功”。下方为 PRD 批准的测试代码：
          </p>
          <pre class="mon-code"><code>import {{ '{' }} Aurora {{ '}' }} from "@aurora/browser";

Aurora.captureException(
  new Error("Aurora SDK 接入测试")
);</code></pre>
          <AppStatusBadge tone="warning">测试事件状态能力未提供</AppStatusBadge>
          <div class="mon-actions-row">
            <button
              type="button"
              class="au-button"
              data-testid="onboarding-recheck"
              :disabled="loading"
              @click="onRecheck"
            >
              重新检查接入链
            </button>
          </div>
        </li>
      </ol>
    </section>
  </section>
</template>

<style scoped>
.mon-status {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}
.mon-note {
  margin: 0;
  color: var(--color-text-secondary);
  max-width: 56ch;
}
.mon-block {
  margin-bottom: var(--space-5);
}
.mon-title {
  margin: 0 0 var(--space-2);
  font-size: 16px;
  color: var(--color-text-primary);
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
.mon-meta {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
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
.mon-steps {
  margin: 0;
  padding-left: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.mon-steps h3 {
  margin: 0 0 var(--space-1);
  font-size: 14px;
  color: var(--color-text-primary);
}
.mon-code {
  margin: var(--space-2) 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  overflow-x: auto;
  background-color: var(--color-surface-bg);
}
.mon-actions-row {
  margin-top: var(--space-3);
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
</style>
