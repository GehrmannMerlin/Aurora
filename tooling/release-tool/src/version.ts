import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkspacePackage } from './contract.js';
import { bumpSemver, formatSemver, parseSemver, type SemverBump } from './semver.js';

/**
 * Independent-version release mechanism (repository-owned equivalent of
 * Changesets): a `.changeset/*.md` file describes which public packages change
 * and by what SemVer bump. The `version` plan applies bumps in dependency
 * order, rewrites `workspace:*` dependency specifiers to real `^range`s and
 * renders a per-package CHANGELOG entry.
 */

export interface Changeset {
  readonly packageName: string;
  readonly bump: SemverBump;
  readonly summary: string;
}

export interface VersionPlanEntry {
  readonly packageName: string;
  readonly bump: SemverBump;
  readonly from: string;
  readonly to: string;
  readonly summary: string;
}

export type ParseChangesetError = { readonly ok: false; readonly reason: string };
export type ParseChangesetOk = {
  readonly ok: true;
  readonly bumps: Readonly<Record<string, SemverBump>>;
  readonly summary: string;
};
export type ParseChangesetResult = ParseChangesetOk | ParseChangesetError;

const BUMP_KEYS: readonly SemverBump[] = ['major', 'minor', 'patch'];

/** Parse a changeset file: YAML-free JSON frontmatter + markdown summary. */
export function parseChangesetFile(content: string): ParseChangesetResult {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content.trimStart());
  if (match === null) return { ok: false, reason: 'missing frontmatter' };
  let frontmatter: unknown;
  try {
    frontmatter = JSON.parse(match[1] ?? '');
  } catch {
    return { ok: false, reason: 'frontmatter is not valid JSON' };
  }
  if (typeof frontmatter !== 'object' || frontmatter === null || Array.isArray(frontmatter)) {
    return { ok: false, reason: 'frontmatter must be a JSON object' };
  }
  const bumps: Record<string, SemverBump> = {};
  for (const [name, value] of Object.entries(frontmatter)) {
    if (typeof value !== 'string' || !BUMP_KEYS.includes(value as SemverBump)) {
      return { ok: false, reason: `invalid bump for ${name}: expected major|minor|patch` };
    }
    bumps[name] = value as SemverBump;
  }
  if (Object.keys(bumps).length === 0) return { ok: false, reason: 'frontmatter has no package bumps' };
  return { ok: true, bumps, summary: (match[2] ?? '').trim() };
}

/** Read every changeset file under `.changeset/` and flatten its bumps. */
export function readChangesets(changesetDir: string): Changeset[] {
  const out: Changeset[] = [];
  let files: string[];
  try {
    files = readdirSync(changesetDir).filter((entry) => entry.endsWith('.md'));
  } catch {
    return out;
  }
  for (const file of files) {
    const content = readFileSync(join(changesetDir, file), 'utf8');
    const parsed = parseChangesetFile(content);
    if (!parsed.ok) continue;
    for (const [packageName, bump] of Object.entries(parsed.bumps)) {
      out.push({ packageName, bump, summary: parsed.summary });
    }
  }
  return out;
}

/**
 * Plan version bumps. Packages are processed in dependency order (a package is
 * planned only after the public packages it depends on), so downstream
 * `workspace:*` rewrites can reference the final target versions.
 */
export function planVersions(
  packages: Map<string, WorkspacePackage>,
  changesets: readonly Changeset[],
): VersionPlanEntry[] {
  const byName = new Map(changesets.map((c) => [c.packageName, c]));
  const planned = new Map<string, string>();
  const visited = new Set<string>();
  const out: VersionPlanEntry[] = [];

  function plan(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    const change = byName.get(name);
    const pkg = packages.get(name);
    if (pkg === undefined) return;
    for (const depName of Object.keys(pkg.manifest.dependencies ?? {})) {
      if (depName.startsWith('@aurora/') && byName.has(depName)) plan(depName);
    }
    const current = pkg.manifest.version ?? '0.0.0';
    const parsed = parseSemver(current);
    if (change === undefined || parsed === null) {
      planned.set(name, current);
      return;
    }
    const next = formatSemver(bumpSemver(parsed, change.bump));
    planned.set(name, next);
    out.push({
      packageName: name,
      bump: change.bump,
      from: current,
      to: next,
      summary: change.summary,
    });
  }

  for (const name of byName.keys()) plan(name);
  return out;
}

/**
 * Rewrite `workspace:*` dependency specifiers of a manifest to `^<version>`
 * using the given final-version map (unplanned workspace deps fall back to
 * their declared current version, which is safe for already-published deps).
 */
export function rewriteWorkspaceDeps(
  deps: Readonly<Record<string, string>> | undefined,
  finalVersions: Readonly<Map<string, string>>,
  packages: Map<string, WorkspacePackage>,
): Record<string, string> | undefined {
  if (deps === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries(deps)) {
    if (spec === 'workspace:*') {
      const version = finalVersions.get(name) ?? packages.get(name)?.manifest.version;
      if (version !== undefined) {
        out[name] = `^${version}`;
        continue;
      }
    }
    out[name] = spec;
  }
  return out;
}

/** Render a CHANGELOG.md entry for one planned release. */
export function renderChangelog(plan: readonly VersionPlanEntry[]): string {
  const byPackage = new Map<string, VersionPlanEntry[]>();
  for (const entry of plan) {
    const list = byPackage.get(entry.packageName) ?? [];
    list.push(entry);
    byPackage.set(entry.packageName, list);
  }
  const blocks: string[] = [];
  for (const entries of byPackage.values()) {
    const first = entries[0];
    if (first === undefined) continue;
    const lines = [`## ${first.to}`, ''];
    for (const entry of entries) {
      lines.push(`- ${entry.summary} (${entry.bump})`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n') + '\n';
}
