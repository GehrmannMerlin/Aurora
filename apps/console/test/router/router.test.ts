import { describe, expect, it } from 'vitest';
import { ROUTE_TARGET_IDS } from '@aurora/platform-contract';
import { appRoutes } from '../../src/router/routes';

describe('console router', () => {
  it('registers a route for every frozen RouteTarget', () => {
    const root = appRoutes[0]!;
    const childNames = new Set((root.children ?? []).map((child) => child.name));
    for (const routeId of ROUTE_TARGET_IDS) {
      expect(childNames.has(routeId), routeId).toBe(true);
    }
  });

  it('registers a not-found catch-all', () => {
    const root = appRoutes[0]!;
    const catchAll = (root.children ?? []).find((child) => child.name === 'not-found');
    expect(catchAll?.path).toBe(':pathMatch(.*)*');
  });

  it('declares lazy components for business targets', () => {
    const root = appRoutes[0]!;
    for (const child of root.children ?? []) {
      if (child.name === 'root' || child.name === 'not-found') continue;
      expect(typeof child.component, String(child.name)).toBe('function');
    }
  });
});
