import type { Router } from 'vue-router';
import { pinia } from '../stores';
import { useSessionStore } from '../stores/session';

export function installSessionGuard(router: Router): void {
  router.beforeEach(async (to) => {
    const session = useSessionStore(pinia);
    if (session.status === 'idle') await session.restore();
    const requiresSession = to.meta.scope !== undefined && to.meta.scope !== 'public';
    if (
      requiresSession &&
      (session.status === 'unauthenticated' || session.status === 'unavailable')
    ) {
      return { name: 'auth.login' };
    }
    return true;
  });
}
