import type { Construct } from 'constructs';
import { resolveEnvironmentConfig } from './config.js';
import type { EnvironmentConfig, EnvironmentName } from './config.js';
import { ComputeStack } from './stacks/compute-stack.js';
import { DataStack } from './stacks/data-stack.js';
import { IdentityStack } from './stacks/identity-stack.js';
import { NetworkStack } from './stacks/network-stack.js';

export interface AuroraEnvironmentStacks {
  readonly network: NetworkStack;
  readonly compute: ComputeStack;
  readonly data: DataStack;
  readonly identity: IdentityStack;
}

/**
 * OPS-04 app composition: builds the four foundation stacks per environment
 * (staging + production, each in its own AWS account). Applies production
 * termination protection. Synth runs without credentials (placeholder accounts
 * are valid for synthesis; `assertDeployable` guards real deploys).
 */
export function buildAuroraApp(
  scope: Construct,
): Readonly<Record<EnvironmentName, AuroraEnvironmentStacks>> {
  const stacks: Record<EnvironmentName, AuroraEnvironmentStacks> = {
    staging: buildEnvironment(scope, 'staging'),
    production: buildEnvironment(scope, 'production'),
  };
  return Object.freeze(stacks);
}

function buildEnvironment(scope: Construct, envName: EnvironmentName): AuroraEnvironmentStacks {
  const env: EnvironmentConfig = resolveEnvironmentConfig(envName);
  const network = new NetworkStack(scope, `Network-${envName}`, { env });
  const compute = new ComputeStack(scope, `Compute-${envName}`, {
    env,
    vpc: network.vpc,
    serviceSecurityGroup: network.serviceSecurityGroup,
  });
  const data = new DataStack(scope, `Data-${envName}`, {
    env,
    vpc: network.vpc,
    databaseSecurityGroup: network.databaseSecurityGroup,
  });
  const identity = new IdentityStack(scope, `Identity-${envName}`, { env });
  for (const stack of [network, compute, data, identity]) {
    stack.terminationProtection = env.isProduction;
  }
  return { network, compute, data, identity };
}
