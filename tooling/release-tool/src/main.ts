import { parseArgs, runCli } from './cli.js';

const options = parseArgs(process.argv.slice(2));
const exitCode = await runCli(options, (text) => process.stdout.write(text));
process.exitCode = exitCode;
