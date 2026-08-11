import {
  aws_ecr as ecr,
  aws_ecs as ecs,
  aws_iam as iam,
  RemovalPolicy,
  Stack,
  Tags,
} from 'aws-cdk-lib';
import type { aws_ec2 as ec2 } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config.js';
import { resourceName, standardTags } from '../naming.js';

export interface ComputeStackProps {
  readonly env: EnvironmentConfig;
  readonly vpc: ec2.IVpc;
}

/**
 * OPS-04 compute foundation (ADR-023 accepted): ECS cluster + ECR repositories
 * (ingestion-api / ingestion-worker) + a minimal ECS task execution role.
 * ECS Service creation, health thresholds, minimum healthy percent and deploy
 * circuit breakers belong to OPS-05; no `AWS::ECS::Service` is created here.
 */
export class ComputeStack extends Stack {
  public readonly cluster: ecs.Cluster;
  public readonly repositories: Readonly<Record<string, ecr.Repository>>;
  public readonly taskExecutionRole: iam.Role;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    const { env, vpc } = props;
    super(scope, id, { env: { account: env.account, region: env.region } });

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: resourceName(env, 'ecs', 'cluster'),
      vpc,
    });

    const repositories: Record<string, ecr.Repository> = {};
    for (const service of ['ingestion-api', 'ingestion-worker'] as const) {
      const repo = new ecr.Repository(this, `Repo${service}`, {
        repositoryName: resourceName(env, 'ecr', service),
        imageScanOnPush: true,
        removalPolicy: env.isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      });
      repo.addLifecycleRule({ maxImageCount: 20 });
      repositories[service] = repo;
    }
    this.repositories = repositories;

    // Minimal task execution role: managed policy covers ECR pull + CloudWatch
    // logs. Secrets access is NOT granted broadly; OPS-05 scopes any
    // secretsmanager statements to the specific secrets it provisions.
    this.taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      roleName: resourceName(env, 'iam', 'ecs-task-execution'),
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    for (const [key, value] of Object.entries(standardTags(env))) {
      Tags.of(this).add(key, value);
    }
  }
}
