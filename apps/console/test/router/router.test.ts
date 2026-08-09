import type { Component } from 'vue';
import { describe, expect, it } from 'vitest';
import { ROUTE_TARGET_IDS } from '@aurora/platform-contract';
import type { RouteRecordRaw } from 'vue-router';
import { appRoutes } from '../../src/router/routes';

type LazyComponent = () => Promise<{ default: Component }>;

function rootRoute(): RouteRecordRaw {
  const root = appRoutes[0];
  if (root === undefined) {
    throw new Error('expected a root route at appRoutes[0]');
  }
  return root;
}

describe('console router', () => {
  it('registers a route for every frozen RouteTarget', () => {
    const root = rootRoute();
    const childNames = new Set((root.children ?? []).map((child) => child.name));
    for (const routeId of ROUTE_TARGET_IDS) {
      expect(childNames.has(routeId), routeId).toBe(true);
    }
  });

  it('registers a not-found catch-all', () => {
    const root = rootRoute();
    const catchAll = (root.children ?? []).find((child) => child.name === 'not-found');
    expect(catchAll?.path).toBe(':pathMatch(.*)*');
  });

  it('declares lazy components for business targets', () => {
    const root = rootRoute();
    for (const child of root.children ?? []) {
      if (child.name === 'root' || child.name === 'not-found') continue;
      expect(typeof child.component, String(child.name)).toBe('function');
    }
  });

  it('resolves every child route lazy loader to a Vue component', async () => {
    const root = rootRoute();
    for (const child of root.children ?? []) {
      const loader = child.component as LazyComponent;
      const mod = await loader();
      expect(mod.default, String(child.name)).toBeDefined();
    }
  });

  it('projects unavailable-route metadata onto the status view props', () => {
    const root = rootRoute();
    // organization.tokens stays an honest unavailable stub until 7C.
    const child = (root.children ?? []).find((c) => c.name === 'organization.tokens');
    const props = child?.props as unknown as (route: { meta: { label: string } }) => {
      title: string;
      reason: string;
    };
    expect(props({ meta: { label: '令牌' } })).toEqual({
      title: '令牌',
      reason: 'capability-not-provided',
    });
  });
});
