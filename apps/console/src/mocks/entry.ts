import { setupWorker } from 'msw/browser';
import { createPlatformHandlers } from './handlers';

export async function setupMockServer(): Promise<void> {
  const worker = setupWorker(...createPlatformHandlers());
  await worker.start({
    serviceWorker: { url: '/mockServiceWorker.js' },
    onUnhandledRequest: 'bypass',
  });
}
