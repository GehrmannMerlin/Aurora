import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';

async function repositoryFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

describe('Core documentation contract', () => {
  it('keeps the module README complete and honest about the increment', async () => {
    const readme = await repositoryFile('packages/core/README.md');
    for (const heading of [
      '## 模块定位',
      '## 职责',
      '## 非职责',
      '## 对外接口',
      '## 生命周期',
      '## 插件契约',
      '## 事件入口',
      '## 诊断与隐私',
      '## 依赖边界',
      '## 开发与测试',
      '## 关联文档',
    ]) {
      expect(readme).toContain(heading);
    }
    expect(readme).toContain('`accepted` 只表示 Core 已启动且信封通过校验');
    expect(readme).toContain('默认 `maxDiagnosticEntries` 为 `100`');
    expect(readme).not.toContain('事件已经进入发送队列');
    expect(readme).not.toContain('Browser 层已经实现');
  });

  it('keeps the formal specification linked from the document index', async () => {
    const index = await repositoryFile('docs/README.md');
    expect(index).toContain('sdk/sdk-core-foundation.md');
    const specification = await repositoryFile('docs/sdk/sdk-core-foundation.md');
    expect(specification).toContain('status: approved');
    expect(specification).toContain('实施状态为 `not-started`');
  });

  it('matches the documented default and repeat semantics', async () => {
    const core = createCore();
    await expect(core.initialize()).resolves.toMatchObject({ code: 'initialized' });
    expect(core.getConfig()).toEqual({ maxDiagnosticEntries: 100 });
    await expect(core.initialize()).resolves.toMatchObject({ code: 'already_initialized' });
    await core.destroy();
    await expect(core.destroy()).resolves.toMatchObject({ code: 'already_destroyed' });
  });
});
