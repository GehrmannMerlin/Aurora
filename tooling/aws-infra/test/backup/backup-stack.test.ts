import { describe, expect, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { resolveEnvironmentConfig } from '../../src/config.js';
import { BackupStack } from '../../src/stacks/backup-stack.js';

function backupTemplate(envName: 'staging' | 'production') {
  const app = new App();
  const stack = new BackupStack(app, `Backup${envName}`, {
    env: resolveEnvironmentConfig(envName),
  });
  return Template.fromStack(stack);
}

describe('OPS-07 backup stack', () => {
  it('creates the backup KMS key with rotation', () => {
    const template = backupTemplate('production');
    template.resourceCountIs('AWS::KMS::Key', 1);
    template.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
  });

  it('creates no destructive / public / object resources', () => {
    const template = backupTemplate('production');
    template.resourceCountIs('AWS::S3::Bucket', 0);
    template.resourceCountIs('AWS::S3::BucketPolicy', 0);
    template.resourceCountIs('AWS::DynamoDB::Table', 0);
  });

  it('tags resources with standard tags', () => {
    const template = backupTemplate('production');
    const raw = JSON.stringify(template.toJSON());
    expect(raw).toContain('"Key":"system","Value":"aurora"');
    expect(raw).toContain('"Key":"environment","Value":"production"');
    expect(raw).toContain('"Key":"managed-by","Value":"cdk"');
  });
});
