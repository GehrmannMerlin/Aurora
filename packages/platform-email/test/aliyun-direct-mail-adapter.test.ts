import { describe, expect, it, vi } from 'vitest';
import {
  AliyunDirectMailAdapter,
  type DirectMailClientPort,
  type DirectMailSingleSendRequest,
} from '../src/aliyun-direct-mail-adapter.js';
import type { EmailDeliveryRequest } from '../src/email-delivery-port.js';

function deliveryRequest(): EmailDeliveryRequest {
  return {
    intentType: 'email_verification',
    toAddress: 'recipient@example.invalid',
    toAddressMasked: 'r***@example.invalid',
    mailLinkUrl: 'https://console.example.invalid/verify?token=transient-secret',
    expiresInMinutes: 120,
  };
}

function adapterWith(client: DirectMailClientPort): AliyunDirectMailAdapter {
  return new AliyunDirectMailAdapter({
    client,
    accountName: 'no-reply@example.invalid',
    fromAlias: 'Aurora',
    timeoutMs: 5_000,
  });
}

describe('AliyunDirectMailAdapter', () => {
  it('maps one recipient to SingleSendMail and returns only the provider request ID', async () => {
    const singleSendMail = vi.fn<DirectMailClientPort['singleSendMail']>().mockResolvedValue({
      requestId: 'provider-request-1',
    });
    const result = await adapterWith({ singleSendMail }).deliver(deliveryRequest());

    expect(result).toEqual({ status: 'accepted', providerRequestId: 'provider-request-1' });
    expect(singleSendMail).toHaveBeenCalledTimes(1);
    const [mapped, timeout] = singleSendMail.mock.calls[0] as [DirectMailSingleSendRequest, number];
    expect(timeout).toBe(5_000);
    expect(mapped).toMatchObject({
      accountName: 'no-reply@example.invalid',
      addressType: 1,
      replyToAddress: false,
      toAddress: 'recipient@example.invalid',
      subject: '验证你的 Aurora 邮箱',
      fromAlias: 'Aurora',
    });
    expect(mapped.htmlBody).toContain('transient-secret');
    expect(mapped.textBody).toContain('transient-secret');
  });

  it.each([
    ['timeout', { name: 'TimeoutError', message: 'raw token=secret' }, 'EMAIL_PROVIDER_TIMEOUT'],
    ['network', { code: 'ECONNRESET', message: 'raw body secret' }, 'EMAIL_PROVIDER_NETWORK'],
    ['throttle', { statusCode: 429, message: 'raw body secret' }, 'EMAIL_PROVIDER_THROTTLED'],
    ['server', { statusCode: 503, message: 'raw body secret' }, 'EMAIL_PROVIDER_UNAVAILABLE'],
  ] as const)(
    'classifies retryable %s failures without raw content',
    async (_label, error, reasonCode) => {
      const client: DirectMailClientPort = { singleSendMail: vi.fn().mockRejectedValue(error) };
      const result = await adapterWith(client).deliver(deliveryRequest());

      expect(result).toEqual({ status: 'failed', retryable: true, reasonCode });
      expect(JSON.stringify(result)).not.toContain('secret');
    },
  );

  it.each([
    ['InvalidAddress.NotFound', 'EMAIL_INVALID_RECIPIENT'],
    ['InvalidAccountName', 'EMAIL_SENDER_NOT_CONFIGURED'],
    ['InvalidAccessKeyId.NotFound', 'EMAIL_PROVIDER_AUTHENTICATION_FAILED'],
    ['SignatureDoesNotMatch', 'EMAIL_PROVIDER_AUTHENTICATION_FAILED'],
    ['Forbidden.RAM', 'EMAIL_PROVIDER_PERMISSION_DENIED'],
    ['InvalidParameter', 'EMAIL_PROVIDER_INVALID_REQUEST'],
  ] as const)('classifies permanent SDK code %s', async (code, reasonCode) => {
    const client: DirectMailClientPort = {
      singleSendMail: vi.fn().mockRejectedValue({ code, message: 'provider raw body secret' }),
    };
    const result = await adapterWith(client).deliver(deliveryRequest());

    expect(result).toEqual({ status: 'failed', retryable: false, reasonCode });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
