<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useNavigationStore } from '../../stores/navigation';
import { useSessionStore } from '../../stores/session';
import { resolveRouteTarget } from '../../contracts/route-registry';
import AppLink from '../aurora/AppLink.vue';
import AppPageHeader from '../aurora/AppPageHeader.vue';
import AppSection from '../aurora/AppSection.vue';
import UnavailableView from './UnavailableView.vue';

const session = useSessionStore();
const navigation = useNavigationStore();
const { status: sessionStatus } = storeToRefs(session);
const { status: navStatus, organizations } = storeToRefs(navigation);

const ready = computed(
  () => sessionStatus.value === 'authenticated' && navStatus.value === 'ready',
);

function orgHref(organizationId: string, routeId: string): string {
  const result = resolveRouteTarget({
    routeId: routeId as never,
    pathParams: { organizationId },
    query: {},
  });
  return result.path ?? '/not-found';
}
</script>

<template>
  <UnavailableView
    v-if="!ready"
    title="工作空间不可用"
    reason="dependency-unavailable"
    detail="导航上下文尚未就绪；不会伪造组织或项目入口。"
  />
  <section v-else data-testid="workspace-home" class="au-surface">
    <AppPageHeader title="工作空间" description="选择组织或项目以进入对应作用域。" />
    <AppSection title="可访问的组织" description="名称和入口均来自当前会话的导航上下文。">
      <ul class="au-org-list">
        <li v-for="org in organizations" :key="org.organizationId">
          <AppLink :to="orgHref(org.organizationId, org.entry.routeId)">
            {{ org.name }}
          </AppLink>
        </li>
      </ul>
    </AppSection>
  </section>
</template>

<style scoped>
.au-org-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
