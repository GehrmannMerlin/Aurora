/**
 * Server-side email mask for display/logging — never the full address
 * (ADR-031 实施约束). Used by the identity handlers for `emailMasked` and
 * outbox `toMasked` fields.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  const domain = at < 0 ? '' : email.slice(at);
  const local = at < 0 ? email : email.slice(0, at);
  if (local.length <= 2) return `${local[0] ?? ''}***${domain}`;
  return `${local.slice(0, 2)}***${domain}`;
}
