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
      if (child.name === 'root') continue;
      const loader = child.component as LazyComponent;
      const mod = await loader();
      expect(mod.default, String(child.name)).toBeDefined();
    }
    // Resolving every lazy loader compiles every view; the monitoring views
    // (PLT-05) add imports, so this legitimately exceeds the default 5s timeout.
  }, 30_000);

  it('projects unavailable-route metadata onto the status view props (no target is unavailable now)', () => {
    const root = rootRoute();
    const children = new Map((root.children ?? []).map((child) => [child.name, child]));
    // PLT-10c (this task) makes platform.resource-policies a real view: no
    // unavailable status-view props override is applied.
    const resourcePolicies = children.get('platform.resource-policies');
    expect(resourcePolicies).toBeDefined();
    expect(resourcePolicies?.props).toBeUndefined();

    // Guard the status-view props projection for any future route that carries
    // an unavailableReason: `appRoutes` must give it a props function projecting
    // title + a stable reason onto the status view.
    const unavailableTargets: string[] = [];
    for (const routeId of ROUTE_TARGET_IDS) {
      const child = children.get(routeId);
      expect(child, routeId).toBeDefined();
      if (child === undefined) continue;
      const props = child.props as unknown;
      if (typeof props !== 'function') continue;
      const fn = props as (route: { meta: { label: string } }) => {
        title: string;
        reason: string;
      };
      const projected = fn({ meta: { label: '占位' } });
      expect(projected.title).toBe('占位');
      expect(projected.reason).toMatch(
        /^(capability-not-provided|dependency-unavailable|permission-unavailable)$/,
      );
      unavailableTargets.push(routeId);
    }
    // PLT-03…PLT-10c progressively replaced every business-target unavailable
    // stub with a real view, so the current invariant is: none remains.
    expect(unavailableTargets).toEqual([]);
  });
});
