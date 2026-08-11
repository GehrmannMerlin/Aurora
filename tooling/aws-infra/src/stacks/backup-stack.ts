import { aws_kms as kms, Stack, Tags } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config.js';
import { resourceName, standardTags } from '../naming.js';

export interface BackupStackProps {
  readonly env: EnvironmentConfig;
}

/**
 * OPS-07 backup resources base.
 *
 * Production RDS automated backup (35 days + PITR + deletion protection) is
 * already configured in DataStack (OPS-04). This stack owns the KMS backup key
 * used to encrypt cross-region / backup-account recovery-point copies.
 *
 * DEFERRED (requires-backup-account — user-owned backup account/second region):
 * the daily cross-region snapshot-copy pipeline and destination KMS key are NOT
 * created here. No destructive resources, no public access, no S3 buckets.
 */
export class BackupStack extends Stack {
  public readonly backupKey: kms.Key;

  constructor(scope: Construct, id: string, props: BackupStackProps) {
    const { env } = props;
    super(scope, id, { env: { account: env.account, region: env.region } });

    this.backupKey = new kms.Key(this, 'BackupKey', {
      alias: resourceName(env, 'kms', 'backup'),
      description: `Aurora ${env.name} backup recovery-point encryption key`,
      enableKeyRotation: true,
    });

    for (const [key, value] of Object.entries(standardTags(env))) {
      Tags.of(this).add(key, value);
    }
  }
}
