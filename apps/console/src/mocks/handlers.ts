import { http, HttpResponse, type JsonBodyType } from 'msw';
import {
  validNavigationSamples,
  validSessionSamples,
} from '@aurora/platform-contract/contract-testkit';

export type MockScope = {
  readonly type: 'workspace' | 'organization' | 'project';
  readonly id?: string;
};

let mockScope: MockScope = { type: 'project', id: 'prj_test_1' };

const navigationBody = JSON.parse(JSON.stringify(validNavigationSamples[0])) as {
  currentScope: unknown;
};

export const handlerControls = {
  delayMs: 0,
  sessionRequests: 0,
};

export function setMockScope(scope: MockScope): void {
  mockScope = scope;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPlatformHandlers() {
  return [
    http.get('/api/platform/v1/session', async () => {
      handlerControls.sessionRequests += 1;
      if (handlerControls.delayMs > 0) await delay(handlerControls.delayMs);
      return HttpResponse.json(validSessionSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.get('/api/platform/v1/navigation/context', () => {
      const body = structuredClone(navigationBody);
      body.currentScope =
        mockScope.type === 'workspace'
          ? { type: 'workspace', lifecycle: 'active' }
          : { type: mockScope.type, id: mockScope.id, lifecycle: 'active' };
      return HttpResponse.json(body, { status: 200 });
    }),
    http.post('/__mock/scope', async ({ request }) => {
      const body = (await request.json()) as MockScope;
      mockScope =
        body.type === 'workspace'
          ? { type: 'workspace' }
          : { type: body.type, id: body.id ?? 'prj_test_1' };
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
