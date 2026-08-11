import { aws_ec2 as ec2, aws_rds as rds, Duration, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config.js';
import { standardTags } from '../naming.js';

export interface DataStackProps {
  readonly env: EnvironmentConfig;
  readonly vpc: ec2.IVpc;
  readonly databaseSecurityGroup: ec2.ISecurityGroup;
}

/**
 * OPS-04 data base (ADR-023 accepted): a private, encrypted RDS PostgreSQL
 * instance with deletion protection and 35-day backups (production Multi-AZ).
 *
 * DEFERRED boundaries (real consumer platform-api + backend ADR required,
 * YAGNI per ADR-023/032): ElastiCache Redis and private S3 (Source Map) are
 * NOT created here. No `AWS::ElastiCache::CacheCluster` / `AWS::S3::Bucket`
 * resources exist in this stack.
 */
export class DataStack extends Stack {
  public readonly database: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    const { env, vpc, databaseSecurityGroup } = props;
    super(scope, id, { env: { account: env.account, region: env.region } });

    this.database = new rds.DatabaseInstance(this, 'Postgres', {
      databaseName: 'aurora',
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_17_5,
      }),
      // Exact instance/capacity is requires-benchmark (ING-13); t3.medium is
      // the foundation placeholder, overridable before provisioning (OPS-05).
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [databaseSecurityGroup],
      multiAz: env.isProduction,
      deletionProtection: env.isProduction,
      storageEncrypted: true,
      backupRetention: Duration.days(35),
      publiclyAccessible: false,
      removalPolicy: env.isProduction ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      allocatedStorage: 20,
      maxAllocatedStorage: 200,
    });

    for (const [key, value] of Object.entries(standardTags(env))) {
      Tags.of(this).add(key, value);
    }
  }
}
