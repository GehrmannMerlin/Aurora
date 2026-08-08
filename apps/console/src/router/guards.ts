import type { Router } from 'vue-router';
import { pinia } from '../stores';
import { useSessionStore } from '../stores/session';

// Pure auth-form pages that an already-authenticated user should never see. The
// intent pages (verify-email-confirm, reset-password, invitation-accept) are
// reached via email links and must render whether or not the user is signed in.
const AUTH_ONLY_ROUTES = new Set(['auth.login', 'auth.register', 'auth.forgot-password']);

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
    if (
      typeof to.name === 'string' &&
      AUTH_ONLY_ROUTES.has(to.name) &&
      session.status === 'authenticated'
    ) {
      return { name: 'workspace.home' };
    }
    return true;
  });
}
