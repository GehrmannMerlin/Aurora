<script setup lang="ts">
import type { UnavailableReason } from '../../contracts/route-types';
import AppEmptyState from '../aurora/AppEmptyState.vue';
import AppPageHeader from '../aurora/AppPageHeader.vue';

withDefaults(
  defineProps<{
    title: string;
    reason: UnavailableReason;
    detail?: string;
  }>(),
  { detail: '' },
);

const reasonLabel: Readonly<Record<UnavailableReason, string>> = {
  'capability-not-provided': '功能未提供',
  'dependency-unavailable': '依赖不可用',
  'permission-unavailable': '权限不足',
};
</script>

<template>
  <section class="au-status au-surface" data-testid="unavailable-view">
    <AppPageHeader :title="title" />
    <AppEmptyState
      :title="reasonLabel[reason]"
      tone="warning"
      :description="detail || '该能力尚未由后端提供；此处不会显示任何模拟数据。'"
    />
  </section>
</template>
