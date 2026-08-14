import { describe, expect, it } from 'vitest';
import { renderTransactionalEmail } from '../src/email-template.js';
import type { EmailDeliveryRequest, EmailIntentType } from '../src/email-delivery-port.js';

const cases: readonly (readonly [EmailIntentType, string])[] = [
  ['email_verification', '验证你的 Aurora 邮箱'],
  ['password_reset', '重置你的 Aurora 密码'],
  ['organization_invitation', '你收到了 Aurora 工作区邀请'],
  ['deletion_confirmation', '确认你的 Aurora 账号操作'],
];

function request(intentType: EmailIntentType): EmailDeliveryRequest {
  return {
    intentType,
    toAddress: 'user@example.invalid',
    toAddressMasked: 'u***@example.invalid',
    mailLinkUrl: 'https://console.example.invalid/action?token=a&next=<unsafe>"\'',
    expiresInMinutes: 120,
  };
}

describe('renderTransactionalEmail', () => {
  it.each(cases)('renders safe UTF-8 HTML and text for %s', (intentType, subject) => {
    const rendered = renderTransactionalEmail(request(intentType));

    expect(rendered.subject).toBe(subject);
    expect(rendered.htmlBody).toContain('Aurora');
    expect(rendered.textBody).toContain('Aurora');
    expect(rendered.htmlBody).toContain('120 分钟');
    expect(rendered.textBody).toContain('120 分钟');
    expect(rendered.htmlBody).not.toContain('<unsafe>');
    expect(rendered.htmlBody).toContain('&lt;unsafe&gt;&quot;&#39;');
    expect(rendered.htmlBody.match(/https:\/\/console\.example\.invalid/g)).toHaveLength(2);
    expect(rendered.htmlBody).not.toMatch(/<img|tracking|attachment/i);
    expect(rendered.textBody).not.toMatch(/tracking|attachment/i);
  });

  it('explains the verification lifetime, fallback link, and unsolicited-message recovery', () => {
    const rendered = renderTransactionalEmail(request('email_verification'));

    expect(rendered.htmlBody).toContain('两小时');
    expect(rendered.textBody).toContain('两小时');
    expect(rendered.textBody).toContain('复制以下链接');
    expect(rendered.textBody).toContain('忽略此邮件');
  });
});
