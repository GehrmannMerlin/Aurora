import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { pinia } from './stores';
import './styles/tokens.css';
import './styles/base.css';

async function bootstrap(): Promise<void> {
  if (import.meta.env.MODE === 'test') {
    const { setupMockServer } = await import('./mocks/entry');
    await setupMockServer();
  }
  const app = createApp(App);
  app.config.errorHandler = (error) => {
    console.error('[console]', error instanceof Error ? error.message : 'unknown');
  };
  app.use(pinia);
  app.use(router);
  app.mount('#app');
}

void bootstrap();
