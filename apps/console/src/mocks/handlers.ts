import { http, HttpResponse, type JsonBodyType } from 'msw';
import {
  validNavigationSamples,
  validSessionSamples,
} from '@aurora/platform-contract/contract-testkit';

export interface MockScope {
  readonly type: 'workspace' | 'organization' | 'project';
  readonly id?: string;
}

const MOCK_SCOPE_STORAGE_KEY = '__aurora_mock_scope';

function readStoredScope(): MockScope {
  try {
    const raw = sessionStorage.getItem(MOCK_SCOPE_STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { type?: string; id?: string } | string | null;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        (parsed.type === 'workspace' || parsed.type === 'organization' || parsed.type === 'project')
      ) {
        return parsed.id === undefined
          ? { type: parsed.type }
          : { type: parsed.type, id: parsed.id };
      }
    }
  } catch {
    // storage may be unavailable (non-browser harness); fall through to the default
  }
  return { type: 'project', id: 'prj_test_1' };
}

let mockScope: MockScope = readStoredScope();

const navigationBody = JSON.parse(JSON.stringify(validNavigationSamples[0])) as {
  currentScope: unknown;
};

export const handlerControls = {
  delayMs: 0,
  sessionRequests: 0,
};

export function setMockScope(scope: MockScope): void {
  mockScope = scope;
  try {
    sessionStorage.setItem(MOCK_SCOPE_STORAGE_KEY, JSON.stringify(scope));
  } catch {
    // storage may be unavailable in some harnesses; the module state still applies
  }
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
    http.get('/api/platform/v1/navigation/context', async () => {
      if (handlerControls.delayMs > 0) await delay(handlerControls.delayMs);
      const body = structuredClone(navigationBody);
      body.currentScope =
        mockScope.type === 'workspace'
          ? { type: 'workspace', lifecycle: 'active' }
          : { type: mockScope.type, id: mockScope.id, lifecycle: 'active' };
      return HttpResponse.json(body, { status: 200 });
    }),
    http.post('/__mock/scope', async ({ request }) => {
      const body = (await request.json()) as MockScope;
      setMockScope(
        body.type === 'workspace'
          ? { type: 'workspace' }
          : { type: body.type, id: body.id ?? 'prj_test_1' },
      );
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
