<script setup lang="ts">
import AppEmptyState from '../aurora/AppEmptyState.vue';
import AppPageHeader from '../aurora/AppPageHeader.vue';

withDefaults(defineProps<{ title?: string }>(), { title: '页面不存在' });
</script>

<template>
  <section class="au-status au-surface" data-testid="not-found-view">
    <AppPageHeader :title="title" />
    <AppEmptyState title="无法打开此页面" description="请求的地址不存在或目标已失效。" />
  </section>
</template>
