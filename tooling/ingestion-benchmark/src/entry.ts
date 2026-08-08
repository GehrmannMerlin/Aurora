import { runBenchmarkCli } from './cli.js';

const code = await runBenchmarkCli(process.env, process.argv.slice(2));
process.exitCode = code;
