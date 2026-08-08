import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

async function collectTsFiles(dir: URL): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = new URL(`${entry.name}/`, dir);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(full)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(fileURLToPath(new URL(entry.name, dir)));
    }
  }
  return files;
}

describe('ingestion-worker security negatives', () => {
  const srcDir = new URL('../src/', import.meta.url);
  const testDir = new URL('../test/', import.meta.url);

  it('does not log event bodies, raw errors, SQL, SQLSTATE, or database URLs in source', async () => {
    const files = await collectTsFiles(srcDir);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      expect(content).not.toMatch(/console\.log/);
      expect(content).not.toMatch(/EventEnvelope\.body|event\.body/);
      expect(content).not.toMatch(/SQLSTATE|constraint.*name/);
      expect(content).not.toMatch(/databaseUrl\s*=\s*.*\?|postgres:\/\/[^"'`]*:[^"'`]*@/);
    }
  });

  it('does not print database credentials or full URLs in test helpers', async () => {
    const helpers = fileURLToPath(new URL('./integration/helpers.ts', testDir));
    const content = await readFile(helpers, 'utf8');
    expect(content).not.toMatch(/console\.log/);
  });

  it('retry backoff modules use no Math.random, timers, or mutable global random state', async () => {
    for (const name of [
      'retry-backoff-types.ts',
      'retry-backoff-policy.ts',
      'retry-backoff-entropy.ts',
    ]) {
      const content = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
      expect(content).not.toMatch(/Math\.random/);
      expect(content).not.toMatch(/setTimeout|setInterval/);
    }
  });

  it('error event processor never emits event bodies, credentials, or database URLs', async () => {
    const processorSource = await readFile(
      new URL('../src/error-event-processor.ts', import.meta.url),
      'utf8',
    );
    expect(processorSource).not.toMatch(/event\.body|EventEnvelope\.body/);
    expect(processorSource).not.toMatch(/console\./);
    expect(processorSource).not.toMatch(/process\.env/);
    expect(processorSource).not.toMatch(/databaseUrl|postgres:\/\/|postgresql:\/\//);
    expect(processorSource).not.toMatch(/SQLSTATE|constraint.*name/);
    expect(processorSource).not.toMatch(
      /X-Aurora-Client-Key|clientKey|Authorization|token|password/,
    );
    expect(processorSource).not.toMatch(/INSERT INTO|SELECT.*FROM/);
  });

  it('request sample selection policy has no side effects, randomness, or sensitive fields', async () => {
    const source = await readFile(
      new URL('../src/request-sample-selection-policy.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/Date\.now|new Date\(/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/persistRequestEventSample|persistRequestMetricContribution/);
    expect(source).not.toMatch(/INSERT INTO|SELECT.*FROM/);
    expect(source).not.toMatch(/event\.body|EventEnvelope\.body/);
    expect(source).not.toMatch(/Authorization|clientKey|token|password/);
  });

  it('request event processor never reads secrets, runs randomness, or hardcodes product thresholds', async () => {
    const source = await readFile(
      new URL('../src/request-event-processor.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/Date\.now/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/INSERT INTO|SELECT.*FROM/);
    expect(source).not.toMatch(/Authorization|clientKey|token|password/);
    expect(source).not.toMatch(/slowRequestThreshold|3000/);
    expect(source).not.toMatch(/additional.*[Ss]tatuses|statusCodes.*=.*\[\]/);
    expect(source).not.toMatch(/request\.body|response\.body|\.headers|\.cookies/);
  });

  it('request processing rules adapter never reads secrets, runs randomness, or writes logs', async () => {
    const source = await readFile(
      new URL('../src/request-processing-rules-adapter.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/Date\.now|new Date\(/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/INSERT INTO|SELECT.*FROM/);
    expect(source).not.toMatch(/Authorization|clientKey|token|password/);
    expect(source).not.toMatch(/request\.body|response\.body|\.headers|\.cookies/);
    expect(source).not.toMatch(/event\.body|EventEnvelope\.body/);
  });

  it('performance event processor never reads secrets, runs randomness, or hardcodes sampling', async () => {
    const source = await readFile(
      new URL('../src/performance-event-processor.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/Date\.now/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/INSERT INTO|SELECT.*FROM/);
    expect(source).not.toMatch(/Authorization|clientKey|token|password/);
    expect(source).not.toMatch(/request\.body|response\.body|\.headers|\.cookies/);
    expect(source).not.toMatch(/event\.body|EventEnvelope\.body/);
    // The processor must never CALL sample persistence or hardcode a sampling
    // rate; the words may appear only in doc comments stating these are out of
    // scope (V1 does not persist diagnostic samples; SDK sampling is separate).
    expect(source).not.toMatch(/persistPerformanceEventSample\(/);
    expect(source).not.toMatch(/sampleRate\s*[:=]|sampleRate\s*\d|0\.1\s*\*\s*/);
  });

  it('event processor router never reads secrets, runs randomness, or touches the database', async () => {
    const source = await readFile(
      new URL('../src/event-processor-router.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/Date\.now|new Date\(/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/INSERT INTO|SELECT.*FROM/);
    expect(source).not.toMatch(/Authorization|clientKey|token|password/);
    expect(source).not.toMatch(/@aurora\/ingestion-inbox|claimAvailable|markProcessed/);
    expect(source).not.toMatch(/new Pool\(|pool\./);
  });
});
