import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function rootFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

describe('Monorepo foundation documentation contract', () => {
  it('documents real workspace commands without stale implementation claims', async () => {
    const readme = await rootFile('README.md');
    expect(readme).toContain('pnpm install --frozen-lockfile');
    expect(readme).toContain('pnpm check');
    expect(readme).not.toContain('当前没有 CI 工作流');
    expect(readme).not.toContain(
      '仓库目前没有 SDK、服务端或管理平台代码，没有机器 OpenAPI、事件 Schema、可执行数据模型、CI、IaC、云资源或部署。',
    );
  });

  it('gives the real internal module one complete README', async () => {
    const moduleReadme = await rootFile('tooling/workspace-policy/README.md');
    for (const heading of [
      '## 职责',
      '## 非职责',
      '## 公开接口',
      '## CLI 与失败语义',
      '## 测试',
      '## 权威来源',
    ]) {
      expect(moduleReadme).toContain(heading);
    }
  });

  it('records only accurate ADR implementation states', async () => {
    await expect(rootFile('docs/adr/ADR-001-use-monorepo.md')).resolves.toContain(
      'implementation-status: in-progress',
    );
    await expect(rootFile('docs/adr/ADR-006-one-way-dependencies.md')).resolves.toContain(
      'implementation-status: in-progress',
    );
    await expect(
      rootFile('docs/adr/ADR-007-workspace-package-and-task-tooling.md'),
    ).resolves.toContain('implementation-status: implemented');
  });
});
