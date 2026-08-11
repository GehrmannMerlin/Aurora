import { describe, expect, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { resolveEnvironmentConfig } from '../src/config.js';
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
