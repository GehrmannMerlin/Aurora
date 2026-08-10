const ABSOLUTE_URL_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/([^/:?#]+)(?::(\d+))?(\/[^?#]*)?$/;

export interface ParsedOrigin {
  readonly scheme: string;
  readonly host: string;
  readonly port: string | null;
  readonly origin: string;
}

export function parseOrigin(url: string): ParsedOrigin | null {
  const match = ABSOLUTE_URL_PATTERN.exec(url.toLowerCase());
  if (match === null) return null;
  const scheme = match[1] as string;
  const host = match[2] as string;
  const rawPort = match[3] ?? null;
  const defaultPort = scheme === 'http' ? '80' : scheme === 'https' ? '443' : null;
  const port = rawPort !== null && rawPort !== defaultPort ? rawPort : null;
  const origin = port === null ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;
  return { scheme, host, port, origin };
}

function isValidHostLabel(label: string): boolean {
  if (label.length === 0 || label.length > 253) return false;
  const labels = label.split('.');
  for (const part of labels) {
    if (part.length === 0 || part.length > 63) return false;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)) return false;
  }
  return true;
}

export function normalizeAllowedOrigin(input: string): string | null {
  const match = /^(https?):\/\/([^/:?#]+)(?::(\d+))?$/.exec(input.trim().toLowerCase());
  if (match === null) return null;
  const scheme = match[1] as string;
  const rawHost = match[2] as string;
  const rawPort = match[3] ?? null;
  let host = rawHost;
  if (host.startsWith('*.')) {
    if (!isValidHostLabel(host.slice(2))) return null;
  } else if (!isValidHostLabel(host)) {
    return null;
  }
  const defaultPort = scheme === 'http' ? '80' : '443';
  const port = rawPort !== null && rawPort !== defaultPort ? rawPort : null;
  return port === null ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;
}

export function originMatchesAllowed(origin: string, allowedEntry: string): boolean {
  if (allowedEntry.includes('*.')) {
    const schemeIndex = allowedEntry.indexOf('://');
    const schemePart = schemeIndex >= 0 ? allowedEntry.slice(0, schemeIndex + 3) : '';
    if (!origin.startsWith(schemePart)) return false;
    const entryHost = allowedEntry.slice(schemePart.length);
    const suffix = entryHost.slice(2);
    if (suffix.length === 0) return false;
    const originHost = origin.slice(schemePart.length);
    if (!originHost.endsWith(`.${suffix}`)) return false;
    const prefix = originHost.slice(0, originHost.length - suffix.length - 1);
    return prefix.length > 0 && !prefix.includes('.');
  }
  return origin === allowedEntry;
}
