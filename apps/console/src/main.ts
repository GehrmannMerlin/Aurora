import { createApp } from 'vue';
import App from './App.vue';
import { pinia } from './stores';
import './styles/tokens.css';
import './styles/base.css';

async function bootstrap(): Promise<void> {
  if (import.meta.env.MODE === 'test') {
    const { setupMockServer } = await import('./mocks/entry');
    await setupMockServer();
  }
  const app = createApp(App);
  app.use(pinia);
  app.mount('#app');
}

void bootstrap();
