import { setupServer } from 'msw/node';
import { createPlatformHandlers } from '../../src/mocks/handlers';

export const mockServer = setupServer(...createPlatformHandlers());
