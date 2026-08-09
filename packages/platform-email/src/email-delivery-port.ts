/**
 * EmailDeliveryPort — the outbound transactional email boundary for the Aurora
 * platform (accepted ADR-031 §决定细节 1).
 *
 * Identity domain logic (email verification, password reset, organization
 * invitation) depends ONLY on this port, never on a concrete provider. A
 * provider adapter implements `deliver`. Delivery is NON-COMMITTAL:
 * `{status:'enqueued'}` means the send request was durably recorded in the
 * outbox, NOT that the inbox received it (ADR-031 决定细节 2).
 *
 * Security invariants (ADR-031 实施约束):
 * - `toAddress` is the normalized recipient needed to send. It is never logged.
 * - `toAddressMasked` is the server-side mask for display/logging and is the
 *   ONLY address an adapter may log.
 * - `mailLinkUrl` embeds the transient one-time intent token — the ONLY place
 *   the raw token exists outside the intent digest store (spec §4.11 token
 *   staging). The adapter must never log it, and the request carries no
 *   separate token field.
 * - No field may ever carry a raw password, verification/reset token, or
 *   provider secret.
 */
export type EmailIntentType =
  'email_verification' | 'password_reset' | 'organization_invitation' | 'deletion_confirmation';

export interface EmailDeliveryRequest {
  readonly intentType: EmailIntentType;
  /** Normalized recipient address (needed to send). Never logged. */
  readonly toAddress: string;
  /** Server-side masked recipient — the only address that may be logged/displayed. */
  readonly toAddressMasked: string;
  /** Mail link URL embedding the transient one-time intent token. */
  readonly mailLinkUrl: string;
  /** Intent expiry in minutes, shown in the rendered mail. */
  readonly expiresInMinutes: number;
}

export type EmailDeliveryResult =
  { readonly status: 'enqueued' } | { readonly status: 'failed'; readonly reason: string };

export interface EmailDeliveryPort {
  readonly deliver: (request: EmailDeliveryRequest) => Promise<EmailDeliveryResult>;
}
