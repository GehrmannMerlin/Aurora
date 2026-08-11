import { describe, expect, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { resolveEnvironmentConfig } from '../src/config.js';
import { ComputeStack, IMMUTABLE_DEPLOY_PLACEHOLDER_TAG } from '../src/stacks/compute-stack.js';
import { NetworkStack } from '../src/stacks/network-stack.js';

function computeTemplate(envName: 'staging' | 'production') {
  const app = new App();
  const env = resolveEnvironmentConfig(envName);
  const network = new NetworkStack(app, `Network${envName}`, { env });
  const compute = new ComputeStack(app, `Compute${envName}`, {
    env,
    vpc: network.vpc,
    serviceSecurityGroup: network.serviceSecurityGroup,
  });
  return Template.fromStack(compute);
}

interface ServiceResource {
  readonly Properties?: {
    readonly ServiceName?: string;
    readonly DeploymentConfiguration?: {
      readonly MinimumHealthyPercent?: number;
      readonly MaximumPercent?: number;
      readonly DeploymentCircuitBreaker?: {
        readonly Enable?: boolean;
        readonly Rollback?: boolean;
      };
    };
    readonly DeploymentController?: { readonly Type?: string };
  };
}

describe('OPS-05 ECS deployment targets', () => {
  it('creates one service per deployable workload', () => {
    const template = computeTemplate('production');
    template.resourceCountIs('AWS::ECS::Service', 2);
    const services = Object.values(
      template.findResources('AWS::ECS::Service'),
    ) as unknown as readonly ServiceResource[];
    const names = services
      .map((service) => service.Properties?.ServiceName)
      .filter((name) => name !== undefined);
    expect(names).toContain('aurora-production-service-ingestion-api');
    expect(names).toContain('aurora-production-service-ingestion-worker');
  });

  it('configures rolling deployment with circuit breaker rollback', () => {
    const template = computeTemplate('production');
    const services = Object.values(
      template.findResources('AWS::ECS::Service'),
    ) as unknown as readonly ServiceResource[];
    for (const service of services) {
      expect(service.Properties?.DeploymentConfiguration?.MinimumHealthyPercent).toBe(100);
      expect(service.Properties?.DeploymentConfiguration?.MaximumPercent).toBe(200);
      expect(service.Properties?.DeploymentConfiguration?.DeploymentCircuitBreaker).toEqual({
        Enable: true,
        Rollback: true,
      });
      expect(service.Properties?.DeploymentController?.Type).toBe('ECS');
    }
  });

  it('references the immutable-deploy placeholder tag, never a floating latest', () => {
    const template = computeTemplate('production');
    const image = JSON.stringify(template.findResources('AWS::ECS::TaskDefinition'));
    expect(image).not.toContain(':latest');
    expect(image).toContain(`:${IMMUTABLE_DEPLOY_PLACEHOLDER_TAG}`);
  });

  it('runs tasks in private subnets without public IP assignment', () => {
    const template = computeTemplate('production');
    const services = Object.values(
      template.findResources('AWS::ECS::Service'),
    ) as unknown as readonly ServiceResource[];
    // AssignPublicIp is encoded in NetworkConfiguration.AwsvpcConfiguration
    const raw = JSON.stringify(template.findResources('AWS::ECS::Service'));
    expect(raw).toContain('"AssignPublicIp":"DISABLED"');
    expect(services.length).toBe(2);
  });

  it('creates no public edge resources (ALB / S3 / CloudFront) — deferred to domain owner', () => {
    const template = computeTemplate('production');
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
    template.resourceCountIs('AWS::S3::Bucket', 0);
    template.resourceCountIs('AWS::CloudFront::Distribution', 0);
  });
});
