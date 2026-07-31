import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function rootFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

describe('Browser documentation contract', () => {
  it('documents responsibilities, privacy, release semantics, and real commands', async () => {
    const readme = await rootFile('packages/browser/README.md');
    for (const heading of [
      '## 模块定位',
      '## 职责',
      '## 非职责',
      '## 公共 API',
      '## 环境与降级',
      '## 隐私与宿主安全',
      '## 资源释放',
      '## 开发与测试',
      '## 权威来源',
    ])
      expect(readme).toContain(heading);
    expect(readme).toContain('pnpm --filter @aurora/browser test:browser');
    expect(readme).toContain('origin + pathname');
    expect(readme).toContain('85%');
    expect(readme).toContain('80%');
    expect(readme).not.toMatch(/Cookie.*采集|完整 URL 查询.*保留/);
  });

  it('records Browser as implemented without overstating plugins or the whole SDK', async () => {
    for (const path of [
      'README.md',
      'docs/architecture/system-overview.md',
      'docs/architecture/sdk-architecture.md',
      'docs/architecture/formalization-readiness.md',
      'AGENTS.md',
      'AURORA_RULES.md',
    ]) {
      const text = await rootFile(path);
      expect(text, path).toContain('@aurora/browser');
      expect(text, path).toContain('浏览器环境能力与页面生命周期基础第一增量');
    }
    expect(await rootFile('docs/architecture/sdk-architecture.md')).toContain(
      '错误、请求、性能、资源和行为插件仍不存在',
    );
  });

  it('keeps ADR states unchanged and appends precise evidence', async () => {
    expect(await rootFile('docs/sdk/browser-environment-foundation.md')).toContain(
      'implementation-status: implemented',
    );
    const adr003 = await rootFile('docs/adr/ADR-003-sdk-plugin-architecture.md');
    const adr005 = await rootFile('docs/adr/ADR-005-event-schema-source-of-truth.md');
    const adr006 = await rootFile('docs/adr/ADR-006-one-way-dependencies.md');
    const adr007 = await rootFile('docs/adr/ADR-007-workspace-package-and-task-tooling.md');
    expect(adr003).toContain('implementation-status: in-progress');
    expect(adr003).toContain('@aurora/browser');
    expect(adr006).toContain('implementation-status: in-progress');
    expect(adr006).toContain('sdk-browser');
    expect(adr005).toContain('implementation-status: in-progress');
    expect(adr007).toContain('implementation-status: implemented');
  });
});
