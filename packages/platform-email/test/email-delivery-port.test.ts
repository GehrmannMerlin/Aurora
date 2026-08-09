import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleEmailAdapter } from '../src/console-email-adapter.js';
import type { EmailDeliveryRequest } from '../src/email-delivery-port.js';

function request(overrides: Partial<EmailDeliveryRequest> = {}): EmailDeliveryRequest {
  return {
    intentType: 'email_verification',
    toAddress: 'user@example.com',
    toAddressMasked: 'u***@example.com',
    mailLinkUrl: 'https://aurora.ah.cn/verify?token=short-lived-transient-token',
    expiresInMinutes: 120,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ConsoleEmailAdapter', () => {
  it('resolves enqueued and logs only the masked address for console mode', async () => {
    const lines: string[] = [];
    const adapter = new ConsoleEmailAdapter({
      mode: 'console',
      log: (message) => lines.push(message),
    });

    const result = await adapter.deliver(request());

    expect(result).toEqual({ status: 'enqueued' });
    expect(lines).toHaveLength(1);
    const line = lines[0];
    if (line === undefined) throw new Error('expected a log line');
    expect(line).toContain('[email] queued email_verification to u***@example.com');
    // NEVER the full address, the mail link URL, or the raw one-time token.
    expect(line).not.toContain('user@example.com');
    expect(line).not.toContain('aurora.ah.cn');
    expect(line).not.toContain('short-lived-transient-token');
  });

  it('treats an unset EMAIL_DELIVERY_MODE as the local console path', async () => {
    vi.stubEnv('EMAIL_DELIVERY_MODE', '');
    const lines: string[] = [];
    const adapter = new ConsoleEmailAdapter({ log: (message) => lines.push(message) });

    const result = await adapter.deliver(
      request({ intentType: 'password_reset', toAddressMasked: 'p***@example.com' }),
    );

    expect(result).toEqual({ status: 'enqueued' });
    const output = lines.join('\n');
    expect(output).toContain('password_reset');
    expect(output).toContain('p***@example.com');
  });

  it('accepts the deletion_confirmation intent type and logs only the masked address', async () => {
    const lines: string[] = [];
    const adapter = new ConsoleEmailAdapter({
      mode: 'console',
      log: (message) => lines.push(message),
    });

    const result = await adapter.deliver(
      request({ intentType: 'deletion_confirmation', toAddressMasked: 'd***@example.com' }),
    );

    expect(result).toEqual({ status: 'enqueued' });
    const output = lines.join('\n');
    expect(output).toContain('deletion_confirmation');
    expect(output).toContain('d***@example.com');
    expect(output).not.toContain('user@example.com');
  });

  it('fails closed for any non-console delivery mode', async () => {
    vi.stubEnv('EMAIL_DELIVERY_MODE', 'resend');
    const adapter = new ConsoleEmailAdapter({ log: () => undefined });

    const result = await adapter.deliver(
      request({ intentType: 'organization_invitation', toAddressMasked: 'i***@example.com' }),
    );

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('EMAIL_PROVIDER_CREDENTIAL_ACTION_REQUIRED');
    }
  });

  it('uses console.log by default and never emits secrets', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const adapter = new ConsoleEmailAdapter({ mode: 'console' });
    try {
      const result = await adapter.deliver(request());
      expect(result).toEqual({ status: 'enqueued' });
      expect(spy).toHaveBeenCalledWith('[email] queued email_verification to u***@example.com');
      expect(spy.mock.calls.map((call) => call[0] as string).join('\n')).not.toContain(
        'short-lived-transient-token',
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('respects the explicit mode option over the environment', async () => {
    vi.stubEnv('EMAIL_DELIVERY_MODE', 'resend');
    const lines: string[] = [];
    const adapter = new ConsoleEmailAdapter({
      mode: 'console',
      log: (message) => lines.push(message),
    });

    const result = await adapter.deliver(request());

    expect(result).toEqual({ status: 'enqueued' });
    expect(lines.join('\n')).toContain('[email] queued');
  });
});
