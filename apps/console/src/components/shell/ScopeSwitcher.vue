<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useNavigationStore } from '../../stores/navigation';

const navigation = useNavigationStore();
const { organizations, currentOrganizationId } = storeToRefs(navigation);

const selected = computed(() => currentOrganizationId.value ?? '');

function onOrgChange(): void {
  navigation.clear();
}
</script>

<template>
  <div class="au-scope-switch">
    <label class="au-scope-label" for="scope-org">组织</label>
    <select id="scope-org" class="au-select" :value="selected" @change="onOrgChange">
      <option value="">未选择</option>
      <option v-for="org in organizations" :key="org.organizationId" :value="org.organizationId">
        {{ org.name }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.au-scope-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.au-select {
  height: var(--control-height);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  padding: 0 var(--space-2);
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
}
</style>
