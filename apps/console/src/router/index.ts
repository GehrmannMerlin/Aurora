import { createRouter, createWebHistory } from 'vue-router';
import { appRoutes } from './routes';
import { installSessionGuard } from './guards';
import { installFocusManagement } from './focus';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [...appRoutes],
});

installSessionGuard(router);
installFocusManagement(router);

router.onError(() => {
  void router.replace({ name: 'route-error' });
});
