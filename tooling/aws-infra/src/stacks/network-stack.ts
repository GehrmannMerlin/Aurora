import { aws_ec2 as ec2, Stack, Tags } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config.js';
import { resourceName, standardTags } from '../naming.js';

export interface NetworkStackProps {
  readonly env: EnvironmentConfig;
}

/**
 * OPS-04 network base (ADR-022 accepted): imperative VPC (no fromLookup so
 * `cdk synth` needs no credentials), public + private-with-egress subnets,
 * NAT for egress, database/service security groups and foundational VPC
 * endpoints (S3 gateway + SecretsManager interface). Precise subnets/SGs/WAF
 * remain implementation-detail for the IaC review (OPS-05 refines).
 */
export class NetworkStack extends Stack {
  public readonly vpc: ec2.IVpc;
  public readonly databaseSecurityGroup: ec2.SecurityGroup;
  public readonly serviceSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    const { env } = props;
    super(scope, id, { env: { account: env.account, region: env.region } });

    // Vpc is cast to IVpc: under exactOptionalPropertyTypes (tsconfig.base)
    // CDK's Vpc class is not structurally assignable to IVpc, but a runtime
    // IVpc. Security groups and downstream stacks consume the IVpc surface.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: resourceName(env, 'vpc', 'main'),
      maxAzs: env.isProduction ? 3 : 2,
      // One NAT for the foundation; production may scale to per-AZ NATs in
      // OPS-05 after capacity benchmarking (ING-13). No cost without deploy.
      natGateways: 1,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    }) as ec2.IVpc;

    this.serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc: this.vpc,
      description: resourceName(env, 'sg', 'service'),
      allowAllOutbound: false,
    });
    this.serviceSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.allTcp(),
      'service egress to internet',
    );

    this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      description: resourceName(env, 'sg', 'database'),
      allowAllOutbound: false,
    });
    this.databaseSecurityGroup.addIngressRule(
      this.serviceSecurityGroup,
      ec2.Port.tcp(5432),
      'PostgreSQL from service SG only',
    );

    // Foundational private-subnet endpoints (no ECR/CloudWatch yet: added in
    // OPS-05 when ECS deploys). S3 gateway is regional and free.
    this.vpc.addGatewayEndpoint('S3GatewayEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });
    this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });

    for (const [key, value] of Object.entries(standardTags(env))) {
      Tags.of(this).add(key, value);
    }
  }
}
