import { nextTick } from 'vue';
import type { Router } from 'vue-router';

export function installFocusManagement(router: Router): void {
  router.afterEach((to) => {
    const label = typeof to.meta.label === 'string' ? to.meta.label : 'Aurora 管理平台';
    document.title = `${label} · Aurora`;
    // afterEach fires when navigation is confirmed but before Vue flushes the
    // RouterView DOM; defer the lookup so focus lands on the NEW page title.
    void nextTick(() => {
      const target = document.getElementById('page-title');
      if (target !== null) {
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    });
  });
}
