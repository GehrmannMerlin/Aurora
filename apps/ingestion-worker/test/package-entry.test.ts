import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildIngestionWorker,
  calculateRetryBackoffSchedule,
  createErrorEventProcessor,
  createEventProcessorRouter,
  createNodeCryptoEntropyProvider,
  createPerformanceEventProcessor,
  createProductionIngestionWorker,
  createRequestEventProcessor,
  createRequestProcessingRulesAdapter,
  decideRetryDisposition,
  DEFAULT_REQUEST_PROCESSING_RULES,
  loadIngestionWorkerConfig,
  startIngestionWorker,
  WorkerDiagnostics,
} from '../src/index.js';

describe('ingestion-worker package entry', () => {
  it('declares the private worker application manifest with service layer', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(manifest).toMatchObject({
      name: '@aurora/ingestion-worker',
      private: true,
      type: 'module',
      aurora: { layer: 'service' },
      engines: { node: '>=24.18.0 <25' },
    });
  });

  it('exports only the package root and ships dist', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const exports = (manifest as { exports?: unknown }).exports;
    expect(exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    });
    const files = (manifest as { files?: unknown }).files;
    expect(files).toContain('dist');
  });

  it('declares workspace data/protocol dependencies and no queue or scheduler frameworks', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const dependencies = (manifest as { dependencies?: Record<string, string> }).dependencies ?? {};
    expect(dependencies['@aurora/ingestion-inbox']).toBe('workspace:*');
    expect(dependencies['@aurora/event-schema']).toBe('workspace:*');
    expect(dependencies.pg).toBe('8.22.0');
    for (const forbidden of ['bullmq', 'redis', 'ioredis', 'node-cron', 'bree']) {
      expect(dependencies[forbidden]).toBeUndefined();
    }
  });

  it('never exposes private paths through the package exports map', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const exports = (manifest as { exports?: unknown }).exports;
    expect(exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    });
  });

  it('exports the public worker API from the package root', () => {
    expect(typeof buildIngestionWorker).toBe('function');
    expect(typeof startIngestionWorker).toBe('function');
    expect(typeof loadIngestionWorkerConfig).toBe('function');
    expect(typeof WorkerDiagnostics).toBe('function');
  });

  it('exports the retry policy API from the package root', () => {
    expect(typeof decideRetryDisposition).toBe('function');
  });

  it('exports the retry backoff API from the package root', () => {
    expect(typeof calculateRetryBackoffSchedule).toBe('function');
    expect(typeof createNodeCryptoEntropyProvider).toBe('function');
  });

  it('exports the error event processor API from the package root', () => {
    expect(typeof createErrorEventProcessor).toBe('function');
  });

  it('exports the request event processor API from the package root', () => {
    expect(typeof createRequestEventProcessor).toBe('function');
  });

  it('declares the processing-store data dependency', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const dependencies = (manifest as { dependencies?: Record<string, string> }).dependencies ?? {};
    expect(dependencies['@aurora/processing-store']).toBe('workspace:*');
  });

  it('never exposes the retry-policy private path', async () => {
    const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).toContain('decideRetryDisposition');
    expect(index).toContain('calculateRetryBackoffSchedule');
  });

  it('exports the request processing rules adapter API from the package root', () => {
    expect(typeof createRequestProcessingRulesAdapter).toBe('function');
    expect(DEFAULT_REQUEST_PROCESSING_RULES.slowRequestThresholdMs).toBe(3000);
  });

  it('does not expose the request-processing-rules private path', async () => {
    const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).toContain('createRequestProcessingRulesAdapter');
    expect(index).toContain('DEFAULT_REQUEST_PROCESSING_RULES');
  });

  it('exports the performance event processor API from the package root', () => {
    expect(typeof createPerformanceEventProcessor).toBe('function');
  });

  it('never exposes the performance-event-processor private path', async () => {
    const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).toContain('createPerformanceEventProcessor');
  });

  it('exports the event processor router API from the package root', () => {
    expect(typeof createEventProcessorRouter).toBe('function');
  });

  it('exports the production worker composition API from the package root', () => {
    expect(typeof createProductionIngestionWorker).toBe('function');
  });

  it('never exposes the production-composition private path', async () => {
    const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).toContain('createProductionIngestionWorker');
  });

  it('never exposes the event-processor-router private path', async () => {
    const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).toContain('createEventProcessorRouter');
  });
});
