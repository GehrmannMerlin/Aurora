import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  parseErrorEventEnvelope,
  parseEventEnvelope,
  parsePerformanceEventEnvelope,
  parseRequestEventEnvelope,
} from '../src/index.js';

async function repositoryFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

function contractExample(document: string, name: string): unknown {
  const marker = `<!-- contract-example:${name} -->`;
  const markerIndex = document.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing contract example marker: ${name}`);
  const fenceStart = document.indexOf('```json', markerIndex);
  const contentStart = document.indexOf('\n', fenceStart) + 1;
  const fenceEnd = document.indexOf('```', contentStart);
  if (fenceStart < 0 || contentStart === 0 || fenceEnd < 0) {
    throw new Error(`Invalid JSON fence for contract example: ${name}`);
  }
  return JSON.parse(document.slice(contentStart, fenceEnd));
}

describe('event-schema documentation contract', () => {
  it('keeps the module README complete and honest about its boundary', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    for (const heading of [
      '## 模块定位',
      '## 职责',
      '## 非职责',
      '## 对外接口',
      '## 输入与输出',
      '## 依赖边界',
      '## 错误与兼容性',
      '## 开发与测试',
      '## 关联文档',
    ]) {
      expect(readme).toContain(heading);
    }
    expect(readme).toContain('当前协议版本：`1`');
    expect(readme).toContain('`body` 保持 `unknown`');
    expect(readme).not.toContain('具体错误事件正文已经实现');
  });

  it('parses the valid README example and rejects the invalid one', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    expect(parseEventEnvelope(contractExample(readme, 'valid-readme')).success).toBe(true);
    const invalid = parseEventEnvelope(contractExample(readme, 'invalid-readme'));
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.issues.map(({ code }) => code)).toContain('unsupported_protocol_version');
    }
  });

  it('keeps the README explicit about the implemented error contract and absent plugin', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    expect(readme).toContain('## 错误事件契约');
    expect(readme).toContain('parseErrorEventBody(input: unknown)');
    expect(readme).toContain('parseErrorEventEnvelope(input: unknown)');
    expect(readme).toContain('JavaScript 运行时错误');
    expect(readme).toContain('未处理 Promise 拒绝');
    expect(readme).toContain('资源加载错误');
    expect(readme).toContain('不实现错误采集插件');
    expect(readme).not.toContain('错误采集插件已经实现');
  });

  it('executes valid and invalid README error examples', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    const valid = parseErrorEventEnvelope(contractExample(readme, 'valid-error-readme'));
    expect(valid.success).toBe(true);
    const invalid = parseErrorEventEnvelope(contractExample(readme, 'invalid-error-readme'));
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.issues.map(({ code }) => code)).toContain('invalid_url');
    }
  });

  it('documents the request contract and keeps the plugin absent', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    expect(readme).toContain('## 请求事件契约');
    expect(readme).toContain('parseRequestEventBody(input: unknown)');
    expect(readme).toContain('parseRequestEventEnvelope(input: unknown)');
    expect(readme).toContain('不实现请求观测');
    expect(readme).toContain('不实现请求采集插件');
    expect(readme).not.toContain('请求观测已经实现');
  });

  it('executes valid and invalid README request examples', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    const valid = parseRequestEventEnvelope(contractExample(readme, 'valid-request-readme'));
    expect(valid.success).toBe(true);
    const invalid = parseRequestEventEnvelope(contractExample(readme, 'invalid-request-readme'));
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.issues.map(({ code }) => code)).toContain('invalid_url');
    }
  });

  it('documents the performance contract and keeps the source/plugin absent', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    expect(readme).toContain('## 性能事件契约');
    expect(readme).toContain('parsePerformanceEventBody(input: unknown)');
    expect(readme).toContain('parsePerformanceEventEnvelope(input: unknown)');
    expect(readme).toContain('不实现性能事实观测');
    expect(readme).toContain('不实现性能采集插件');
    expect(readme).toContain('`lcp`、`inp`、`cls`、`page_load`');
    expect(readme).not.toContain('性能采集插件已经实现');
  });

  it('executes valid and invalid README performance examples', async () => {
    const readme = await repositoryFile('packages/event-schema/README.md');
    const valid = parsePerformanceEventEnvelope(
      contractExample(readme, 'valid-performance-readme'),
    );
    expect(valid.success).toBe(true);
    const invalid = parsePerformanceEventEnvelope(
      contractExample(readme, 'invalid-performance-readme'),
    );
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.issues.map(({ code }) => code)).toContain('invalid_enum');
    }
  });
});
