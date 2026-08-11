/**
 * Minimal SemVer helpers for the Aurora SDK release contract.
 *
 * These are intentionally small and local: the release tool only needs to
 * parse, compare and bump package versions for the independent-version
 * release chain. They intentionally do NOT implement the full SemVer 2.0.0
 * spec; unknown identifiers are rejected with a stable error.
 */

export type SemverBump = 'major' | 'minor' | 'patch';

export interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[] | null;
}

export function parseSemver(raw: string): ParsedSemver | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(raw);
  if (match === null) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return null;
  }
  const prerelease = match[4] === undefined ? null : match[4].split('.');
  return { major, minor, patch, prerelease };
}

/** Stable error result for invalid version input. */
export type SemverParseError = { readonly ok: false; readonly reason: 'invalid_semver' };
export type SemverParseOk = { readonly ok: true; readonly value: ParsedSemver };
export type SemverParseResult = SemverParseOk | SemverParseError;

export function parseSemverResult(raw: string): SemverParseResult {
  const parsed = parseSemver(raw);
  if (parsed === null) return { ok: false, reason: 'invalid_semver' };
  return { ok: true, value: parsed };
}

/**
 * Deterministic SemVer comparison. `null` prerelease (a stable release) sorts
 * after any prerelease of the same core tuple; prerelease identifiers compare
 * numerically when both are numeric, otherwise lexically, per SemVer 2.0.0.
 */
export function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i += 1) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNum = /^\d+$/.test(left) ? Number(left) : null;
    const rightNum = /^\d+$/.test(right) ? Number(right) : null;
    if (leftNum !== null && rightNum !== null) {
      if (leftNum !== rightNum) return leftNum - rightNum;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

export function formatSemver(parsed: ParsedSemver): string {
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.prerelease === null ? core : `${core}-${parsed.prerelease.join('.')}`;
}

/**
 * Bump a parsed version by the requested change type. A prerelease input is
 * treated as its stable core for the bump (e.g. `1.2.3-beta.1` + `patch`
 * → `1.2.4`), matching the stable-release path of the release chain.
 */
export function bumpSemver(parsed: ParsedSemver, bump: SemverBump): ParsedSemver {
  if (bump === 'major') return { major: parsed.major + 1, minor: 0, patch: 0, prerelease: null };
  if (bump === 'minor') return { major: parsed.major, minor: parsed.minor + 1, patch: 0, prerelease: null };
  return { major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1, prerelease: null };
}

/** Attach a prerelease identifier list to a stable version (e.g. alpha, beta). */
export function withPrerelease(parsed: ParsedSemver, identifiers: readonly string[]): ParsedSemver {
  return { ...parsed, prerelease: identifiers };
}
