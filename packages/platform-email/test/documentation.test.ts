import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function text(relativeUrl: string): Promise<string> {
  return readFile(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('platform email operator documentation', () => {
  it('documents provider acceptance, non-delivering console mode, scrubbing, and no-secret rules', async () => {
    const readme = await text('../README.md');
    expect(readme).toContain('AliyunDirectMailAdapter');
    expect(readme).toContain('SingleSendMail');
    expect(readme).toContain('accepted');
    expect(readme).toContain('不代表收件箱');
    expect(readme).toContain('console');
    expect(readme).toContain('不发送');
    expect(readme).toContain('终态');
    expect(readme).toContain('payload');
    expect(readme).toContain('默认凭据链');
    expect(readme).toContain('不得');
    expect(readme).toContain('AccessKey');
  });

  it('links a runbook with manual DirectMail, smoke, cost, and rollback steps', async () => {
    const runbook = await text('../../../docs/operations/aliyun-direct-mail-email-verification.md');
    for (const required of [
      'notifications.aurora.ah.cn',
      'support@notifications.aurora.ah.cn',
      'DNS',
      'RAM',
      '费用',
      '两条',
      '停止 platform-worker',
      'verified',
      'consumed',
      'implemented-in-feature-branch / deployment-blocked',
    ]) {
      expect(runbook).toContain(required);
    }
  });
});
