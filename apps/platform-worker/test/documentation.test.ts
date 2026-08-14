import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function text(relativeUrl: string): Promise<string> {
  return readFile(new URL(relativeUrl, import.meta.url), 'utf8');
}

const workerEnvironmentNames = [
  'EMAIL_DELIVERY_MODE',
  'ALIYUN_DIRECT_MAIL_ACCOUNT_NAME',
  'ALIYUN_DIRECT_MAIL_FROM_ALIAS',
  'ALIYUN_DIRECT_MAIL_REGION_ID',
  'ALIYUN_DIRECT_MAIL_ENDPOINT',
  'EMAIL_PROVIDER_TIMEOUT_MS',
  'EMAIL_OUTBOX_PROCESSING_TIMEOUT_MS',
  'EMAIL_OUTBOX_RETRY_BASE_DELAY_MS',
  'EMAIL_OUTBOX_RETRY_MAX_DELAY_MS',
] as const;

describe('platform worker deployment documentation', () => {
  it('documents exact public provider and outbox reliability configuration', async () => {
    const readme = await text('../README.md');
    for (const name of workerEnvironmentNames) expect(readme).toContain(name);
    expect(readme).toContain('processing');
    expect(readme).toContain('claim_id');
    expect(readme).toContain('fencing');
    expect(readme).toContain('300000');
  });

  it('requires an explicit provider in Preview and scopes provider settings to the worker', async () => {
    const compose = await text('../../../deploy/preview/compose.yaml');
    const platformApi = compose.slice(
      compose.indexOf('  platform-api:'),
      compose.indexOf('  platform-worker:'),
    );
    const platformWorker = compose.slice(compose.indexOf('  platform-worker:'));
    const consoleService = compose.slice(
      compose.indexOf('  console:'),
      compose.indexOf('  redis:'),
    );

    expect(platformWorker).toContain('- EMAIL_DELIVERY_MODE=aliyun');
    expect(platformWorker).not.toContain('${EMAIL_DELIVERY_MODE');
    for (const name of workerEnvironmentNames) expect(platformWorker).toContain(name);
    expect(platformApi).not.toContain('EMAIL_DELIVERY_MODE');
    expect(consoleService).not.toContain('ALIYUN_DIRECT_MAIL');
    expect(consoleService).not.toContain('ALIBABA_CLOUD_ACCESS_KEY');
  });

  it('provides blank protected credential fallbacks without tracked values', async () => {
    const example = await text('../../../deploy/preview/.env.example');
    expect(example).toMatch(/^# ALIBABA_CLOUD_ACCESS_KEY_ID=$/mu);
    expect(example).toMatch(/^# ALIBABA_CLOUD_ACCESS_KEY_SECRET=$/mu);
    expect(example).toContain('EMAIL_DELIVERY_MODE=aliyun');
  });

  it('loads protected worker settings from the server-only shared env during deploy and rollback', async () => {
    const deploy = await text('../../../deploy/preview/scripts/deploy-preview.sh');
    const rollback = await text('../../../deploy/preview/scripts/rollback-preview.sh');
    expect(deploy).toContain("--env-file '${REMOTE_ROOT}/shared/.env'");
    expect(rollback).toContain("--env-file '${REMOTE_ROOT}/shared/.env'");
  });

  it('fails closed on incompatible rollback and stops the current worker before pointer changes', async () => {
    const rollback = await text('../../../deploy/preview/scripts/rollback-preview.sh');
    const marker = 'deploy/preview/email-outbox-schema-compatibility';
    expect(rollback).toContain(marker);
    expect(rollback).toContain('ROLLBACK INCOMPATIBLE');
    expect(rollback).toContain('stop platform-worker');

    const compatibilityCheck = rollback.indexOf('ROLLBACK INCOMPATIBLE');
    const stopWorker = rollback.indexOf('stop platform-worker');
    const pointerChange = rollback.indexOf("rm -f '${CURRENT_DIR}'");
    expect(compatibilityCheck).toBeGreaterThan(-1);
    expect(stopWorker).toBeGreaterThan(compatibilityCheck);
    expect(pointerChange).toBeGreaterThan(stopWorker);
  });
});
