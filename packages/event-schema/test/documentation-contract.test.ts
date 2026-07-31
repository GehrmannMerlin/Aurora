import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseEventEnvelope } from '../src/index.js';

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

  it('parses the valid protocol example and rejects the forbidden-field example', async () => {
    const protocol = await repositoryFile('docs/protocol/event-envelope-v1.md');
    expect(parseEventEnvelope(contractExample(protocol, 'valid-protocol')).success).toBe(true);
    const invalid = parseEventEnvelope(contractExample(protocol, 'invalid-protocol'));
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.issues.map(({ code }) => code)).toContain('forbidden_field');
    }
  });
});
