import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('ingestion-credentials documentation contract', () => {
  it('keeps the module README complete and honest about its boundary', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain('@aurora/ingestion-credentials');
    expect(readme).toContain('aurora_ingest_');
    expect(readme).toContain('verifyIngestionCredential');
    expect(readme).toContain('AURORA_TEST_DATABASE_URL');
    // Must not claim a management HTTP API or full audit exists.
    expect(readme).not.toContain('管理 HTTP API 已实现');
    expect(readme).not.toContain('完整审计已实现');
  });

  it('keeps the formal lifecycle spec aligned with the implemented module', async () => {
    const spec = await readFile(
      new URL('../../../docs/security/ingestion-client-credential-lifecycle.md', import.meta.url),
      'utf8',
    );
    expect(spec).toContain('implementation-status');
    expect(spec).toContain('createIngestionClientCredential');
    expect(spec).toContain('rotateIngestionClientCredential');
    expect(spec).toContain('SELECT ... FOR UPDATE');
    expect(spec).toContain('不实现管理 HTTP API');
  });

  it('keeps the module README honest about lifecycle without claiming a management HTTP API', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain('rotateIngestionClientCredential');
    expect(readme).not.toContain('管理 HTTP API 已实现');
  });
});
