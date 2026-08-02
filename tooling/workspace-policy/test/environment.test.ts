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

async function createProtocolSource(source: string): Promise<WorkspaceFixture> {
  const protocol = validManifest('@aurora/event-schema');
  protocol.aurora = { layer: 'protocol' };
  return createWorkspaceFixture([
    { directory: 'packages/event-schema', manifest: protocol, files: { 'src/index.ts': source } },
  ]);
}

async function createPluginSource(source: string): Promise<WorkspaceFixture> {
  const plugin = validManifest('@aurora/plugin-error');
  plugin.aurora = { layer: 'sdk-plugin' };
  return createWorkspaceFixture([
    { directory: 'packages/plugin-error', manifest: plugin, files: { 'src/index.ts': source } },
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
    "import { randomUUID } from 'node:crypto'; export const id = randomUUID();",
    "import process from 'node:process'; export const id = process.pid;",
    "export const id = Buffer.from('x').toString();",
    'export const id = process.hrtime.bigint();',
  ])('rejects sdk-core Node runtime API: %s', async (source) => {
    fixture = await createCoreSource(source);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'forbidden-runtime-global', packageName: '@aurora/core' }),
      ]),
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

  it.each([
    'event.preventDefault();',
    'event.stopPropagation();',
    'event.stopImmediatePropagation();',
  ])('rejects sdk-browser event control: %s', async (statement) => {
    fixture = await createBrowserSource(
      `export function handle(event: Event): void { ${statement} }`,
    );
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'forbidden-host-event-control' })]),
    );
  });
});

describe('protocol source policy', () => {
  it.each([
    'export const leaked = window;',
    'export const leaked = document;',
    'export const leaked = navigator;',
    'export const leaked = fetch;',
    'export const leaked = process;',
    'export const leaked = Buffer;',
    "import { readFile } from 'node:fs/promises'; export { readFile };",
  ])('rejects environment-specific protocol source: %s', async (source) => {
    fixture = await createProtocolSource(source);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'forbidden-runtime-global',
          packageName: '@aurora/event-schema',
        }),
      ]),
    );
  });

  it('accepts environment-neutral protocol constants and pure functions', async () => {
    fixture = await createProtocolSource(
      "export const kind = 'error' as const; export function parse(input: unknown): boolean { return typeof input === 'string'; }",
    );
    await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({
      ok: true,
      violations: [],
    });
  });
});

describe('sdk-plugin source policy', () => {
  it.each([
    'export const leaked = window;',
    'export const leaked = document;',
    'export const leaked = navigator;',
    'export const leaked = globalThis;',
    "import { randomUUID } from 'node:crypto'; export const id = randomUUID();",
  ])('rejects direct environment access: %s', async (source) => {
    fixture = await createPluginSource(source);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'forbidden-runtime-global' })]),
    );
  });

  it.each([
    'let active = false; export const read = (): boolean => active;',
    'const entries: string[] = []; export const read = (): number => entries.length;',
    'const listeners = new Set<string>(); export const read = (): number => listeners.size;',
  ])('rejects module-level mutable state: %s', async (source) => {
    fixture = await createPluginSource(source);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'mutable-module-state' })]),
    );
  });

  it.each([
    'window.onerror = null;',
    'event.preventDefault();',
    'event.stopPropagation();',
    'event.stopImmediatePropagation();',
  ])('rejects host mutation or event control: %s', async (statement) => {
    fixture = await createPluginSource(`export function run(event: Event): void { ${statement} }`);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.ok).toBe(false);
  });
});
