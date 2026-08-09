import type {
  EmailDeliveryPort,
  EmailDeliveryRequest,
  EmailDeliveryResult,
} from './email-delivery-port.js';

export interface ConsoleEmailAdapterOptions {
  /** Override `EMAIL_DELIVERY_MODE` (primarily for tests). */
  readonly mode?: string;
  /** Log sink override (defaults to `console.log`). */
  readonly log?: (message: string) => void;
}

/**
 * Local / Preview email delivery path (ADR-031 Preview 门禁).
 *
 * Env-gated on `EMAIL_DELIVERY_MODE`: when unset or `'console'`, this adapter
 * resolves `{status:'enqueued'}` and logs ONLY
 * `[email] queued <intentType> to <masked>`. It NEVER logs the full recipient
 * address, the mail link URL, or the raw one-time token. It is NOT real
 * delivery and must never be treated as such by tests or the worker (delivery
 * is non-committal).
 *
 * Any other mode value fails closed with
 * `EMAIL_PROVIDER_CREDENTIAL_ACTION_REQUIRED` — a real provider adapter is a
 * future, user-authorized addition (ADR-031 §6.3); no secret is ever required
 * or logged here.
 */
export class ConsoleEmailAdapter implements EmailDeliveryPort {
  private readonly log: (message: string) => void;

  constructor(private readonly options: ConsoleEmailAdapterOptions = {}) {
    this.log =
      options.log ??
      ((message: string) => {
        console.log(message);
      });
  }

  deliver(request: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
    const mode = (this.options.mode ?? process.env.EMAIL_DELIVERY_MODE ?? '').trim().toLowerCase();
    if (mode !== '' && mode !== 'console') {
      return Promise.resolve({
        status: 'failed',
        reason: 'EMAIL_PROVIDER_CREDENTIAL_ACTION_REQUIRED',
      });
    }
    this.log(`[email] queued ${request.intentType} to ${request.toAddressMasked}`);
    return Promise.resolve({ status: 'enqueued' });
  }
}
