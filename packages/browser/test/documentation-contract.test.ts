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
    expect(readme).toContain('subscribeErrorSources');
    expect(readme).toContain('subscribeRequests');
    expect(readme).toContain('错误源');
    expect(readme).toContain('请求观测');
    expect(readme).toContain('不读取请求/响应正文');
    expect(readme).toContain('恢复原始宿主引用');
  });

});
