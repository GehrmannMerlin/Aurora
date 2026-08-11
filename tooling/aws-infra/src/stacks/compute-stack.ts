import {
  aws_ec2 as ec2,
  aws_ecr as ecr,
  aws_ecs as ecs,
  aws_iam as iam,
  aws_logs as logs,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config.js';
import { resourceName, standardTags } from '../naming.js';

export interface ComputeStackProps {
  readonly env: EnvironmentConfig;
  readonly vpc: ec2.IVpc;
  readonly serviceSecurityGroup: ec2.ISecurityGroup;
}

/**
 * The ECR tag used by the IaC bootstrap task definitions. The OPS-05 deploy
 * tooling registers digest-pinned task definition revisions before any real
 * rollout; this placeholder must never be deployed as a release basis
 * (floating `latest` is forbidden, deployment.md §5 / TDR §5.1).
 */
export const IMMUTABLE_DEPLOY_PLACEHOLDER_TAG = 'bootstrap-placeholder';

interface DeployServiceSpec {
  readonly repoKey: 'ingestion-api' | 'ingestion-worker';
  readonly containerPort?: number;
  readonly cpu: number;
  readonly memoryMiB: number;
  readonly environment: Readonly<Record<string, string>>;
}

const DEPLOY_SERVICES: readonly DeployServiceSpec[] = [
  {
    repoKey: 'ingestion-api',
    containerPort: 8080,
    cpu: 256,
    memoryMiB: 512,
    environment: { HOST: '0.0.0.0', PORT: '8080' },
  },
  {
    // Background worker: no listener port, no container health check. Deploy
    // health is the ECS service deployment circuit breaker + desired count.
    repoKey: 'ingestion-worker',
    cpu: 256,
    memoryMiB: 512,
    environment: {},
  },
];

/**
 * OPS-04 compute foundation (ADR-023 accepted): ECS cluster + ECR repositories
 * (ingestion-api / ingestion-worker) + a minimal ECS task execution role.
 *
 * OPS-05 owns ECS Service creation and deployment settings (health threshold,
 * minHealthyPercent/maxHealthyPercent, deploy circuit breaker + rollback):
 * one Fargate service per deployable workload, running in private subnets with
 * the shared service security group. Image references use the immutable-deploy
 * placeholder tag; the deploy tooling replaces it with digest-pinned revisions.
 * No public ALB / CloudFront / S3 edge resources are created (edge/DNS/TLS
 * require a user-provided domain, ADR-024).
 */
export class ComputeStack extends Stack {
  public readonly cluster: ecs.Cluster;
  public readonly repositories: Readonly<Record<string, ecr.Repository>>;
  public readonly taskExecutionRole: iam.Role;
  public readonly services: Readonly<Record<string, ecs.FargateService>>;
  public readonly logGroups: Readonly<Record<string, logs.ILogGroup>>;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    const { env, vpc, serviceSecurityGroup } = props;
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

    const services: Record<string, ecs.FargateService> = {};
    const logGroups: Record<string, logs.ILogGroup> = {};
    for (const spec of DEPLOY_SERVICES) {
      const logGroup = new logs.LogGroup(this, `LogGroup${spec.repoKey}`, {
        logGroupName: resourceName(env, 'logs', spec.repoKey),
        retention: logs.RetentionDays.THREE_MONTHS,
        removalPolicy: env.isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      });
      logGroups[spec.repoKey] = logGroup;

      const taskRole = new iam.Role(this, `TaskRole${spec.repoKey}`, {
        roleName: resourceName(env, 'iam', `task-${spec.repoKey}`),
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      });

      const taskDefinition = new ecs.FargateTaskDefinition(this, `TaskDef${spec.repoKey}`, {
        family: resourceName(env, 'task', spec.repoKey),
        cpu: spec.cpu,
        memoryLimitMiB: spec.memoryMiB,
        executionRole: this.taskExecutionRole,
        taskRole,
      });

      const repo = repositories[spec.repoKey];
      if (repo === undefined) {
        throw new Error(`compute_stack_internal: missing ECR repository for ${spec.repoKey}`);
      }
      taskDefinition.addContainer(spec.repoKey, {
        image: ecs.ContainerImage.fromEcrRepository(repo, IMMUTABLE_DEPLOY_PLACEHOLDER_TAG),
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: spec.repoKey, logGroup }),
        environment: spec.environment,
        ...(spec.containerPort === undefined
          ? {}
          : {
              portMappings: [{ containerPort: spec.containerPort }],
              healthCheck: {
                command: [
                  'CMD-SHELL',
                  `node -e "const s=require('node:net').connect(${String(spec.containerPort)},'127.0.0.1');s.on('error',()=>process.exit(1));s.on('connect',()=>{s.destroy();process.exit(0)})"`,
                ],
                interval: Duration.seconds(30),
                timeout: Duration.seconds(5),
                retries: 3,
                startPeriod: Duration.seconds(30),
              },
            }),
      });

      const fargateService = new ecs.FargateService(this, `Service${spec.repoKey}`, {
        serviceName: resourceName(env, 'service', spec.repoKey),
        cluster: this.cluster as ecs.ICluster,
        taskDefinition,
        desiredCount: 1,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [serviceSecurityGroup],
        assignPublicIp: false,
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        deploymentController: { type: ecs.DeploymentControllerType.ECS },
        circuitBreaker: { enable: true, rollback: true },
      });
      services[spec.repoKey] = fargateService;
    }
    this.services = services;
    this.logGroups = logGroups;

    for (const [key, value] of Object.entries(standardTags(env))) {
      Tags.of(this).add(key, value);
    }
  }
}
