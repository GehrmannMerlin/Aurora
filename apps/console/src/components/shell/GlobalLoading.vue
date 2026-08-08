<template>
  <div class="au-global-loading" role="status" aria-live="polite">正在恢复会话…</div>
</template>

<style scoped>
.au-global-loading {
  position: fixed;
  top: var(--space-4);
  right: var(--space-4);
  padding: var(--space-2) var(--space-4);
  background-color: var(--color-surface-bg);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-base);
  color: var(--color-text-primary);
  background-image: none;
}
</style>
