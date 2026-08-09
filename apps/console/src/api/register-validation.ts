import { identityRegisterRequest } from '@aurora/platform-contract';

/**
 * Register field validation derived from the single source of truth —
 * `identityRegisterRequest` in `@aurora/platform-contract`. No second copy of
 * the rule lives here: the exact zod schema that `platformRequest` enforces
 * before the network request is used for the client-side check, and the hint
 * text reads min/max straight from the schema's OpenAPI projection so wording
 * can never drift from the contract.
 *
 * The contract only constrains email length (3–320) and password length
 * (8–256). There is no password composition rule — ADR-030 governs Argon2id
 * storage parameters, not format — so the messages state exactly that and add
 * no invented requirements.
 */

const emailRule = identityRegisterRequest.openapi.properties?.email;
const passwordRule = identityRegisterRequest.openapi.properties?.password;

const EMAIL_MIN = emailRule?.minLength ?? 3;
const EMAIL_MAX = emailRule?.maxLength ?? 320;
const PASSWORD_MIN = passwordRule?.minLength ?? 8;
const PASSWORD_MAX = passwordRule?.maxLength ?? 256;

/** Shown ahead of input, next to each field. */
export const REGISTER_EMAIL_HINT = `请输入 ${EMAIL_MIN}–${EMAIL_MAX} 个字符的邮箱地址。`;
export const REGISTER_PASSWORD_HINT = `密码需为 ${PASSWORD_MIN}–${PASSWORD_MAX} 个字符。`;

/** Field-level messages, shown next to the offending field on invalid input. */
const EMAIL_RULE_TEXT = `请输入 ${EMAIL_MIN}–${EMAIL_MAX} 个字符的邮箱地址。`;
const PASSWORD_RULE_TEXT = `密码需为 ${PASSWORD_MIN}–${PASSWORD_MAX} 个字符。`;

// A contract-valid placeholder so the shared parse only ever reports
// email/password issues; the real key is generated at submit time.
const PLACEHOLDER_KEY = 'k'.repeat(36);

export interface RegisterFieldErrors {
  readonly email: string | null;
  readonly password: string | null;
}

export function validateRegisterInput(email: string, password: string): RegisterFieldErrors {
  const result = identityRegisterRequest.zod.safeParse({
    email,
    password,
    idempotencyKey: PLACEHOLDER_KEY,
  });
  if (result.success) return { email: null, password: null };

  let emailError: string | null = null;
  let passwordError: string | null = null;
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (field === 'email' && emailError === null) emailError = EMAIL_RULE_TEXT;
    if (field === 'password' && passwordError === null) passwordError = PASSWORD_RULE_TEXT;
  }
  return { email: emailError, password: passwordError };
}
