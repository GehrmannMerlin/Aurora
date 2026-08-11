import { describe, expect, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { resolveEnvironmentConfig } from '../src/config.js';
import { ComputeStack } from '../src/stacks/compute-stack.js';
import { DataStack } from '../src/stacks/data-stack.js';
import { NetworkStack } from '../src/stacks/network-stack.js';

const templateCache = new Map<string, Template>();

function networkTemplate(envName: 'staging' | 'production'): Template {
  const cached = templateCache.get(envName);
  if (cached !== undefined) return cached;
  const app = new App();
  const stack = new NetworkStack(app, `Network${envName}`, {
    env: resolveEnvironmentConfig(envName),
  });
  const template = Template.fromStack(stack);
  templateCache.set(envName, template);
  return template;
}

interface VpcResource {
  readonly Type: string;
  readonly Properties?: {
    readonly Tags?: readonly { readonly Key: string; readonly Value: string }[];
  };
}

describe('network base stack', () => {
  it('creates a VPC with public and private subnets', () => {
    const template = networkTemplate('staging');
    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.resourceCountIs('AWS::EC2::Subnet', 4); // 2 AZ × public+private
  });

  it('uses three AZs for production', () => {
    const template = networkTemplate('production');
    template.resourceCountIs('AWS::EC2::Subnet', 6); // 3 AZ × public+private
  });

  it('creates a NAT gateway for egress', () => {
    const template = networkTemplate('production');
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
  });

  it('exposes a database security group allowing PostgreSQL only from the service SG', () => {
    const template = networkTemplate('production');
    template.resourceCountIs('AWS::EC2::SecurityGroup', 3); // VPC default + service + database
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      IpProtocol: 'tcp',
      FromPort: 5432,
      ToPort: 5432,
    });
  });

  it('adds foundational S3 gateway and SecretsManager interface endpoints', () => {
    const template = networkTemplate('production');
    template.resourceCountIs('AWS::EC2::VPCEndpoint', 2);
  });

  it('tags all resources with standard tags', () => {
    const template = networkTemplate('production');
    const vpcResources = Object.values(
      template.findResources('AWS::EC2::VPC'),
    ) as unknown as readonly VpcResource[];
    expect(vpcResources).toHaveLength(1);
    const tags = vpcResources[0]?.Properties?.Tags;
    expect(tags).toBeDefined();
    expect(tags).toContainEqual({ Key: 'system', Value: 'aurora' });
    expect(tags).toContainEqual({ Key: 'environment', Value: 'production' });
    expect(tags).toContainEqual({ Key: 'Owner', Value: 'aurora-cloud-ops' });
    expect(tags).toContainEqual({ Key: 'managed-by', Value: 'cdk' });
    expect(tags).toContainEqual({ Key: 'cost-center', Value: 'aurora-monitoring' });
  });
});

function composedStacks(envName: 'staging' | 'production') {
  const app = new App();
  const env = resolveEnvironmentConfig(envName);
  const network = new NetworkStack(app, `Network${envName}`, { env });
  const data = new DataStack(app, `Data${envName}`, {
    env,
    vpc: network.vpc,
    databaseSecurityGroup: network.databaseSecurityGroup,
  });
  const compute = new ComputeStack(app, `Compute${envName}`, { env, vpc: network.vpc });
  return { data, compute };
}

describe('data stack', () => {
  it('creates a private, encrypted RDS PostgreSQL with 35-day backups', () => {
    const { data } = composedStacks('staging');
    const template = Template.fromStack(data);
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceClass: 'db.t3.medium',
      Engine: 'postgres',
      StorageEncrypted: true,
      PubliclyAccessible: false,
      BackupRetentionPeriod: 35,
    });
  });

  it('enables production deletion protection and Multi-AZ', () => {
    const { data } = composedStacks('production');
    const template = Template.fromStack(data);
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DeletionProtection: true,
      MultiAZ: true,
    });
  });

  it('does not enable deletion protection on staging', () => {
    const { data } = composedStacks('staging');
    const template = Template.fromStack(data);
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DeletionProtection: false,
      MultiAZ: false,
    });
  });
});

describe('compute stack', () => {
  it('creates an ECS cluster and ECR repositories for the ingestion workloads', () => {
    const { compute } = composedStacks('production');
    const template = Template.fromStack(compute);
    template.resourceCountIs('AWS::ECS::Cluster', 1);
    template.resourceCountIs('AWS::ECR::Repository', 2);
    template.resourceCountIs('AWS::IAM::Role', 1); // task execution role
  });

  it('does not create ECS services (OPS-05)', () => {
    const { compute } = composedStacks('production');
    const template = Template.fromStack(compute);
    template.resourceCountIs('AWS::ECS::Service', 0);
  });
});

describe('deferred boundaries', () => {
  it('creates no ElastiCache, private S3 or ECS service resources (YAGNI)', () => {
    const { data, compute } = composedStacks('production');
    const dataTemplate = Template.fromStack(data);
    const computeTemplate = Template.fromStack(compute);
    dataTemplate.resourceCountIs('AWS::ElastiCache::CacheCluster', 0);
    dataTemplate.resourceCountIs('AWS::S3::Bucket', 0);
    computeTemplate.resourceCountIs('AWS::ECS::Service', 0);
  });
});
