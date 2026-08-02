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
    expect(readme).toContain('`accepted` 只表示 Core 已启动且事件通过校验');
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

  it('documents the standard draft boundary and exact exclusions', async () => {
    const readme = await repositoryFile('packages/core/README.md');
    for (const phrase of [
      'CoreEventDraft',
      'CoreEventIdProvider',
      'CoreEventTimeProvider',
      'submitEventDraft',
      'CURRENT_PROTOCOL_VERSION',
      'parseEventEnvelope',
      'event_creation_failed',
      'globalThis.crypto.randomUUID',
    ])
      expect(readme).toContain(phrase);
    expect(readme).toContain('不表示采样、排队、发送或持久化');
    expect(readme).not.toContain('plugin-error 已实现');
  });

  it('keeps the specification approved and ADR decisions unchanged', async () => {
    const specification = await repositoryFile('docs/sdk/core-event-creation.md');
    expect(specification).toContain('status: approved');
    expect(specification).toContain('implementation-status: implemented');
    expect(await repositoryFile('docs/adr/ADR-003-sdk-plugin-architecture.md')).toContain(
      'implementation-status: in-progress',
    );
    expect(await repositoryFile('docs/adr/ADR-005-event-schema-source-of-truth.md')).toContain(
      'implementation-status: in-progress',
    );
    expect(await repositoryFile('docs/adr/ADR-006-one-way-dependencies.md')).toContain(
      'implementation-status: in-progress',
    );
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
