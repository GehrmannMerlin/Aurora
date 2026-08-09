import type { Router } from 'vue-router';
import { pinia } from '../stores';
import { useNavigationStore } from '../stores/navigation';
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
    // Org-scoped routes require membership of the target org. The server re-checks
    // the authoritative membership row on every request; this guard only short-
    // circuits navigation to an org the navigation context does not expose, and
    // stays silent when the context is still loading or unavailable.
    if (
      session.status === 'authenticated' &&
      (to.meta.scope === 'organization' || to.meta.scope === 'project')
    ) {
      const navigation = useNavigationStore(pinia);
      if (navigation.status === 'idle') await navigation.load();
      const organizationId = to.params.organizationId;
      if (
        typeof organizationId === 'string' &&
        navigation.status === 'ready' &&
        !navigation.organizations.some((org) => org.organizationId === organizationId)
      ) {
        return { name: 'forbidden' };
      }
    }
    return true;
  });
}
