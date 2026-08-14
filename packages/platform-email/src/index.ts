/**
 * @aurora/platform-email — Aurora platform transactional email data layer.
 *
 * PLT-03 Task 5: `EmailDeliveryPort` (accepted ADR-031), the local/Preview
 * `ConsoleEmailAdapter`, and the transactional outbox consumer
 * (`consumeOutboxEmails`, ADR-032).
 *
 * This is a data-layer package: it depends only on external PostgreSQL and
 * official Alibaba Cloud SDK packages. Per Workspace Policy (`data →
 * {protocol}` only) it declares NO workspace dependency on
 * `@aurora/platform-identity` (also data); instead the outbox repository
 * functions it needs are injected via the `OutboxRepository` interface
 * (argument injection). It never imports or declares `@aurora/platform-contract`
 * (contract layer).
 *
 * Delivery is non-committal: `{status:'accepted'}` means the provider accepted
 * the API request, NOT that the inbox received it (ADR-031 决定细节 2).
 */
export const PLATFORM_EMAIL_PACKAGE = '@aurora/platform-email' as const;

export const PLATFORM_EMAIL_VERSION = '0.0.0' as const;

export type {
  EmailDeliveryPort,
  EmailDeliveryRequest,
  EmailDeliveryResult,
  EmailIntentType,
} from './email-delivery-port.js';

export { ConsoleEmailAdapter, type ConsoleEmailAdapterOptions } from './console-email-adapter.js';

export { renderTransactionalEmail, type RenderedTransactionalEmail } from './email-template.js';

export {
  AliyunDirectMailAdapter,
  type AliyunDirectMailAdapterOptions,
  type DirectMailClientPort,
  type DirectMailSingleSendRequest,
} from './aliyun-direct-mail-adapter.js';

export {
  createAliyunDirectMailClient,
  type AliyunDirectMailClientOptions,
} from './aliyun-direct-mail-client.js';

export {
  consumeOutboxEmails,
  type ClaimOutboxRowsInput,
  type ClaimOutboxRowsResult,
  type ConsumeOutboxEmailsInput,
  type ConsumeOutboxEmailsResult,
  type InsertOutboxRowInput,
  type InsertOutboxRowResult,
  type MarkOutboxResultInput,
  type MarkOutboxResultResult,
  type OutboxEmailPayload,
  type OutboxRepository,
  type OutboxRow,
  type OutboxStatus,
} from './outbox-consumer.js';

export { calculateEmailRetryDelay, type CalculateEmailRetryDelayInput } from './retry-policy.js';
