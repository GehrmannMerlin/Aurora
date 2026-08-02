export const KEY_ID_BYTES = 16;
export const SECRET_BYTES = 32;
export const KEY_ID_LENGTH = 22;
export const SECRET_LENGTH = 43;
export const CLIENT_KEY_PREFIX = 'aurora_ingest_';

export interface ParsedClientKey {
  readonly keyId: string;
  readonly secret: string;
}

const CLIENT_KEY_PATTERN = /^aurora_ingest_([A-Za-z0-9_-]{22})_([A-Za-z0-9_-]{43})$/;

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Strictly decode an unpadded base64url string, verifying charset and byte length. */
function decodeBase64UrlUnpadded(value: string, expectedBytes: number): Uint8Array | null {
  for (const char of value) {
    if (!BASE64URL_ALPHABET.includes(char)) return null;
  }
  if (value.includes('=')) return null;
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`;
  const standard = padded.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Buffer.from(standard, 'base64');
  if (bytes.length !== expectedBytes) return null;
  return bytes;
}

/**
 * Strictly parse a client reporting key of the form
 * `aurora_ingest_<keyId>_<secret>`. Returns null on any format violation.
 * Never normalizes case; never accepts padding, whitespace, or extra segments.
 */
export function parseIngestionClientKey(clientKey: string): ParsedClientKey | null {
  if (typeof clientKey !== 'string') return null;
  const match = CLIENT_KEY_PATTERN.exec(clientKey);
  if (match === null) return null;
  const keyId = match[1] ?? '';
  const secret = match[2] ?? '';
  // Verify the segments decode to exactly 16 and 32 bytes.
  if (decodeBase64UrlUnpadded(keyId, KEY_ID_BYTES) === null) return null;
  if (decodeBase64UrlUnpadded(secret, SECRET_BYTES) === null) return null;
  return { keyId, secret };
}

/** Decode the base64url secret back to its 32 raw bytes, or null if invalid. */
export function decodeSecretBytes(secret: string): Uint8Array | null {
  return decodeBase64UrlUnpadded(secret, SECRET_BYTES);
}
