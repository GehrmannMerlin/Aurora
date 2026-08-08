import { describe, expect, it } from 'vitest';
import { writeBenchmarkReport } from '../src/report-writer.js';
import type { IngestionBenchmarkReport } from '../src/types.js';
import { generateRunId } from '../src/run-id.js';

function sampleReport(): IngestionBenchmarkReport {
  return {
    schemaVersion: 1,
    run: {
      runId: generateRunId(),
      startedAt: '2026-08-02T00:00:00.000Z',
      completedAt: '2026-08-02T00:01:00.000Z',
      profile: 'smoke',
      success: true,
      gitCommit: null,
      gitDirty: false,
    },
    environment: {
      nodeVersion: 'v24.18.0',
      pnpmVersion: '11.17.0',
      platform: 'win32',
      arch: 'x64',
      cpuModel: 'test',
      logicalCores: 8,
      totalMemoryBytes: 0,
      postgresServerVersionNum: 170010,
      pgClientVersion: '8.22.0',
      apiPoolMax: 0,
      workerPoolMax: 0,
    },
    scenarios: [],
    correctness: { passed: true, checks: [] },
  };
}

describe('report-writer', () => {
  it('writes a versioned report and returns its path', async () => {
    const dir = await import('node:fs/promises').then((fs) => fs.mkdtemp('aurora-bench-report-'));
    const path = await writeBenchmarkReport(sampleReport(), {
      outputDir: dir,
      profile: 'smoke',
    });
    const content = await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8'));
    const parsed = JSON.parse(content) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBe(1);
    await import('node:fs/promises').then((fs) => fs.rm(dir, { recursive: true, force: true }));
  });

  it('refuses an output path that escapes the project root', async () => {
    await expect(
      writeBenchmarkReport(sampleReport(), {
        outputDir: '../../escape',
        profile: 'smoke',
      }),
    ).rejects.toThrow(/escapes project root/);
  });
});
