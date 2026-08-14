import type { EmailDeliveryRequest, EmailIntentType } from './email-delivery-port.js';

export interface RenderedTransactionalEmail {
  readonly subject: string;
  readonly htmlBody: string;
  readonly textBody: string;
}

const SUBJECTS: Readonly<Record<EmailIntentType, string>> = {
  email_verification: '验证你的 Aurora 邮箱',
  password_reset: '重置你的 Aurora 密码',
  organization_invitation: '你收到了 Aurora 工作区邀请',
  deletion_confirmation: '确认你的 Aurora 账号操作',
};

const ACTION_LABELS: Readonly<Record<EmailIntentType, string>> = {
  email_verification: '验证邮箱',
  password_reset: '重置密码',
  organization_invitation: '接受邀请',
  deletion_confirmation: '确认账号操作',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeText(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]/g, ' ');
}

function validityText(request: EmailDeliveryRequest): string {
  if (!Number.isSafeInteger(request.expiresInMinutes) || request.expiresInMinutes < 1) {
    throw new TypeError('expiresInMinutes must be a positive integer');
  }
  if (request.intentType === 'email_verification' && request.expiresInMinutes === 120) {
    return '此链接将在两小时（120 分钟）后失效。';
  }
  return `此链接将在 ${String(request.expiresInMinutes)} 分钟后失效。`;
}

/** Render bounded, image-free transactional HTML and plain text. */
export function renderTransactionalEmail(
  request: EmailDeliveryRequest,
): RenderedTransactionalEmail {
  const subject = SUBJECTS[request.intentType];
  const action = ACTION_LABELS[request.intentType];
  const validity = validityText(request);
  const escapedLink = escapeHtml(request.mailLinkUrl);
  const textLink = safeText(request.mailLinkUrl);
  const unsolicited = '如果你没有发起此操作，请忽略此邮件；你的账号不会因此发生变化。';

  return {
    subject,
    htmlBody: `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
  <body>
    <main>
      <h1>${escapeHtml(subject)}</h1>
      <p>请使用下面的安全链接完成 ${escapeHtml(action)}。</p>
      <p><a href="${escapedLink}">${escapeHtml(action)}</a></p>
      <p>${escapeHtml(validity)}</p>
      <p>如果按钮不可用，请复制以下链接：</p>
      <p><code>${escapedLink}</code></p>
      <p>${escapeHtml(unsolicited)}</p>
    </main>
  </body>
</html>`,
    textBody: `${subject}

请使用以下安全链接完成${action}：
${textLink}

${validity}
如果链接无法直接打开，请复制以下链接到浏览器：${textLink}

${unsolicited}`,
  };
}
