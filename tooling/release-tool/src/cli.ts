import { isPublicPackageName } from './contract.js';
import { validateWorkspace } from './validate.js';
import { planVersions, readChangesets, renderChangelog } from './version.js';
import { checkExportsTypes, checkProtocolDecoupling, checkWorkspaceDepRewritePlan } from './compat.js';
import { runSizeGate, formatSizeResults } from './size.js';
import { packPublicPackage } from './pack.js';
import { discoverPublicPackages, discoverWorkspacePackages } from './contract.js';
import { buildDeprecateArgs, buildDistTagArgs, describeRollback } from './deprecate.js';
import { parseSemverResult } from './semver.js';
import { join } from 'node:path';

export type CommandName =
  | 'validate'
  | 'version'
  | 'pack'
  | 'compat'
  | 'size'
  | 'deprecate'
  | 'latest'
  | 'rollback';

export interface CliOptions {
  command: CommandName;
  root: string;
  changesetDir?: string;
  pkg?: string;
  version?: string;
  message?: string;
  dryRun: boolean;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const args = [...argv];
  const command = args[0] as CommandName;
  const rest = args.slice(1);
  const options: CliOptions = {
    command,
    root: process.cwd(),
    dryRun: false,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const value = rest[i + 1];
    if (arg === '--root' && value !== undefined) {
      options.root = value;
      i += 1;
    } else if (arg === '--changeset-dir' && value !== undefined) {
      options.changesetDir = value;
      i += 1;
    } else if (arg === '--pkg' && value !== undefined) {
      options.pkg = value;
      i += 1;
    } else if (arg === '--version' && value !== undefined) {
      options.version = value;
      i += 1;
    } else if (arg === '--message' && value !== undefined) {
      options.message = value;
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }
  return options;
}

const COMMANDS: readonly CommandName[] = [
  'validate',
  'version',
  'pack',
  'compat',
  'size',
  'deprecate',
  'latest',
  'rollback',
];

export async function runCli(options: CliOptions, write: (text: string) => void): Promise<number> {
  const { command, root, dryRun } = options;
  switch (command) {
    case 'validate': {
      const result = validateWorkspace(root);
      write(
        result.ok
          ? `validate: PASS (${result.publicChecked} public, ${result.privateChecked} private)\n`
          : `validate: FAIL\n${result.issues.map((i) => `  - ${i.packageName}: ${i.message}`).join('\n')}\n`,
      );
      return result.ok ? 0 : 1;
    }
    case 'compat': {
      const publicPackages = discoverPublicPackages(root);
      const issues = [
        ...checkExportsTypes(publicPackages),
        ...checkProtocolDecoupling(root),
        ...checkWorkspaceDepRewritePlan(publicPackages, []),
      ];
      write(issues.length === 0 ? 'compat: PASS\n' : `compat: FAIL\n${issues.map((i) => `  - ${i.packageName}: ${i.message}`).join('\n')}\n`);
      return issues.length === 0 ? 0 : 1;
    }
    case 'size': {
      const result = await runSizeGate(root);
      write(`${formatSizeResults(result.results)}\n`);
      write(result.ok ? 'size: PASS\n' : 'size: FAIL\n');
      return result.ok ? 0 : 1;
    }
    case 'pack': {
      const publicPackages = discoverPublicPackages(root);
      let failed = false;
      for (const pkg of publicPackages.values()) {
        const result = packPublicPackage(pkg);
        write(`${pkg.name}: ${result.assertion.ok ? 'PASS' : 'FAIL'} (${result.fileCount} files)\n`);
        for (const issue of result.assertion.issues) {
          write(`  - ${issue.message}\n`);
        }
        if (!result.assertion.ok) failed = true;
      }
      return failed ? 1 : 0;
    }
    case 'version': {
      const changesetDir = options.changesetDir ?? join(root, '.changeset');
      const changesets = readChangesets(changesetDir);
      if (changesets.length === 0) {
        write('version: no changesets found; nothing to plan\n');
        return 0;
      }
      const packages = discoverWorkspacePackages(root, ['packages']);
      const plan = planVersions(packages, changesets);
      write(
        plan.length === 0
          ? 'version: no public packages matched changesets\n'
          : plan.map((entry) => `  ${entry.packageName} ${entry.from} -> ${entry.to} (${entry.bump})`).join('\n') + '\n',
      );
      write('--- CHANGELOG ---\n');
      write(renderChangelog(plan));
      return 0;
    }
    case 'deprecate': {
      if (options.pkg === undefined || options.version === undefined || options.message === undefined) {
        write('usage: release-tool deprecate --pkg @aurora/x --version 0.1.0 --message "reason"\n');
        return 2;
      }
      if (!isPublicPackageName(options.pkg)) {
        write(`deprecate: ${options.pkg} is not a public package\n`);
        return 1;
      }
      if (parseSemverResult(options.version).ok === false) {
        write(`deprecate: invalid version "${options.version}"\n`);
        return 2;
      }
      const args = buildDeprecateArgs(options.pkg, options.version, options.message);
      write(dryRun ? `[dry-run] npm ${args.join(' ')}\n` : `npm ${args.join(' ')}\n`);
      return dryRun ? 0 : 0; // execution requires a live registry credential; CLI prints the command
    }
    case 'latest': {
      if (options.pkg === undefined || options.version === undefined) {
        write('usage: release-tool latest --pkg @aurora/x --version <known-good-version>\n');
        return 2;
      }
      const args = buildDistTagArgs(options.pkg, options.version, 'latest');
      write(dryRun ? `[dry-run] npm ${args.join(' ')}\n` : `npm ${args.join(' ')}\n`);
      return 0;
    }
    case 'rollback': {
      if (options.pkg === undefined || options.version === undefined) {
        write('usage: release-tool rollback --pkg @aurora/x --version <known-good-version> (bad version = current latest)\n');
        return 2;
      }
      const steps = describeRollback(options.pkg, 'bad-version', options.version);
      write(steps.map((step) => `  ${step}`).join('\n') + '\n');
      return 0;
    }
    default:
      write(`usage: release-tool <${COMMANDS.join('|')}> [--root <path>] [--dry-run] ...\n`);
      return 2;
  }
}
