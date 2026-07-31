import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkWorkspace } from './check-workspace.js';
import { formatViolations } from './format.js';

export interface CliIo {
  readonly stderr: (message: string) => void;
}

export async function runCli(args: readonly string[], io: CliIo): Promise<number> {
  if (args.length !== 2 || args[0] !== '--root' || args[1] === undefined) {
    io.stderr('workspace-policy: expected --root <path>\n');
    return 2;
  }
  try {
    const result = await checkWorkspace(resolve(args[1]));
    if (result.ok) return 0;
    io.stderr(formatViolations(result));
    return 1;
  } catch {
    io.stderr('workspace-policy: unable to read Workspace\n');
    return 2;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = await runCli(process.argv.slice(2), {
    stderr: (message) => process.stderr.write(message),
  });
}
