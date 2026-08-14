import type {
  EmailDeliveryPort,
  EmailDeliveryRequest,
  EmailDeliveryResult,
} from './email-delivery-port.js';
import { renderTransactionalEmail } from './email-template.js';

export interface DirectMailSingleSendRequest {
  readonly accountName: string;
  readonly addressType: 1;
  readonly replyToAddress: false;
  readonly toAddress: string;
  readonly subject: string;
  readonly htmlBody: string;
  readonly textBody: string;
  readonly fromAlias: string;
}

export interface DirectMailClientPort {
  singleSendMail(
    request: DirectMailSingleSendRequest,
    timeoutMs: number,
  ): Promise<{ readonly requestId?: string }>;
}

export interface AliyunDirectMailAdapterOptions {
  readonly client: DirectMailClientPort;
  readonly accountName: string;
  readonly fromAlias: string;
  readonly timeoutMs: number;
}

interface ProviderErrorShape {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly status?: unknown;
  readonly statusCode?: unknown;
  readonly response?: { readonly status?: unknown; readonly statusCode?: unknown };
}

function normalizedErrorFacts(error: unknown): { readonly code: string; readonly status?: number } {
  if (typeof error !== 'object' || error === null) return { code: '' };
  const shaped = error as ProviderErrorShape;
  const codeValue = typeof shaped.code === 'string' ? shaped.code : shaped.name;
  const code = typeof codeValue === 'string' ? codeValue.toLowerCase() : '';
  const statusValue =
    shaped.statusCode ?? shaped.status ?? shaped.response?.statusCode ?? shaped.response?.status;
  return {
    code,
    ...(typeof statusValue === 'number' && Number.isFinite(statusValue)
      ? { status: statusValue }
      : {}),
  };
}

function failed(retryable: boolean, reasonCode: string): EmailDeliveryResult {
  return { status: 'failed', retryable, reasonCode };
}

/** Normalize an SDK failure without returning its message, body, request or headers. */
function classifyProviderFailure(error: unknown): EmailDeliveryResult {
  const { code, status } = normalizedErrorFacts(error);
  if (status === 429 || code.includes('throttl')) {
    return failed(true, 'EMAIL_PROVIDER_THROTTLED');
  }
  if ((status !== undefined && status >= 500) || code.includes('serviceunavailable')) {
    return failed(true, 'EMAIL_PROVIDER_UNAVAILABLE');
  }
  if (code.includes('timeout') || code === 'etimedout' || code === 'esockettimedout') {
    return failed(true, 'EMAIL_PROVIDER_TIMEOUT');
  }
  if (['econnreset', 'econnrefused', 'enotfound', 'eai_again', 'enetunreach'].includes(code)) {
    return failed(true, 'EMAIL_PROVIDER_NETWORK');
  }
  if (code.includes('accesskey') || code.includes('signature') || code.includes('auth')) {
    return failed(false, 'EMAIL_PROVIDER_AUTHENTICATION_FAILED');
  }
  if (code.includes('address') || code.includes('recipient')) {
    return failed(false, 'EMAIL_INVALID_RECIPIENT');
  }
  if (code.includes('accountname') || code.includes('sender')) {
    return failed(false, 'EMAIL_SENDER_NOT_CONFIGURED');
  }
  if (code.includes('parameter') || code.includes('request') || error instanceof TypeError) {
    return failed(false, 'EMAIL_PROVIDER_INVALID_REQUEST');
  }
  if (code.includes('forbidden') || code.includes('permission') || code.endsWith('.ram')) {
    return failed(false, 'EMAIL_PROVIDER_PERMISSION_DENIED');
  }
  return failed(true, 'EMAIL_PROVIDER_UNKNOWN');
}

/** Provider adapter for Aliyun DirectMail SingleSendMail. */
export class AliyunDirectMailAdapter implements EmailDeliveryPort {
  constructor(private readonly options: AliyunDirectMailAdapterOptions) {}

  async deliver(request: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
    try {
      const rendered = renderTransactionalEmail(request);
      const result = await this.options.client.singleSendMail(
        {
          accountName: this.options.accountName,
          addressType: 1,
          replyToAddress: false,
          toAddress: request.toAddress,
          subject: rendered.subject,
          htmlBody: rendered.htmlBody,
          textBody: rendered.textBody,
          fromAlias: this.options.fromAlias,
        },
        this.options.timeoutMs,
      );
      return {
        status: 'accepted',
        ...(result.requestId === undefined ? {} : { providerRequestId: result.requestId }),
      };
    } catch (error) {
      return classifyProviderFailure(error);
    }
  }
}
