import { afterEach, describe, expect, it } from 'vitest';
import { checkWorkspace } from '../src/check-workspace.js';
import { createWorkspaceFixture, type WorkspaceFixture, validManifest } from './fixtures.js';

let fixture: WorkspaceFixture | undefined;

afterEach(async () => fixture?.dispose());

async function createCoreSource(source: string): Promise<WorkspaceFixture> {
  const core = validManifest('@aurora/core');
  core.aurora = { layer: 'sdk-core' };
  return createWorkspaceFixture([
    { directory: 'packages/core', manifest: core, files: { 'src/index.ts': source } },
  ]);
}

async function createBrowserSource(source: string): Promise<WorkspaceFixture> {
  const browser = validManifest('@aurora/browser');
  browser.aurora = { layer: 'sdk-browser' };
  return createWorkspaceFixture([
    { directory: 'packages/browser', manifest: browser, files: { 'src/index.ts': source } },
  ]);
}

describe('sdk-core source policy', () => {
  it('accepts immutable module constants and per-factory mutable state', async () => {
    fixture = await createCoreSource(
      'const defaultLimit = 100; export function createValue(): number { let value = defaultLimit; value += 1; return value; }',
    );
    await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({ ok: true, violations: [] });
  });

  it.each([
    'window',
    'document',
    'navigator',
    'location',
    'fetch',
    'XMLHttpRequest',
    'localStorage',
    'sessionStorage',
    'Document',
    'Storage',
    'EventTarget',
    'HTMLElement',
  ])('rejects the browser global %s', async (identifier) => {
    fixture = await createCoreSource(`export const leaked = ${identifier};`);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'forbidden-runtime-global' })]),
    );
  });

  it('rejects computed access to a browser global', async () => {
    fixture = await createCoreSource("export const leaked = globalThis['window'];");
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'forbidden-runtime-global' })]),
    );
  });

  it.each([
    'let shared = 0; export function read(): number { return shared; }',
    'var shared = 0; export function read(): number { return shared; }',
    'const shared = new Map<string, number>(); export function read(): number { return shared.size; }',
    'const shared: number[] = []; export function read(): number { return shared.length; }',
    'const shared = { value: 1 }; export function read(): number { return shared.value; }',
  ])('rejects module-level mutable state', async (source) => {
    fixture = await createCoreSource(source);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'mutable-module-state' })]),
    );
  });
});

describe('sdk-browser source policy', () => {
  it.each([
    'let shared = 0; export function read(): number { return shared; }',
    'const shared = new Set<string>(); export function read(): number { return shared.size; }',
    'const shared: string[] = []; export function read(): number { return shared.length; }',
  ])('rejects sdk-browser module-level mutable state', async (source) => {
    fixture = await createBrowserSource(source);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'mutable-module-state' })]),
    );
  });

  it.each([
    'window.onerror = null;',
    'window.onunhandledrejection = null;',
    'globalThis.fetch = replacement;',
    'XMLHttpRequest.prototype.open = replacement;',
    'history.pushState = replacement;',
    'Object.defineProperty(window, "onerror", { value: null });',
    'Reflect.set(globalThis, "fetch", replacement);',
  ])('rejects sdk-browser host mutation: %s', async (source) => {
    fixture = await createBrowserSource(`const replacement = (): void => undefined; ${source}`);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'forbidden-host-mutation' })]),
    );
  });
});
