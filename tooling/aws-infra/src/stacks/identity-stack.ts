import { aws_iam as iam, Stack, Tags } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config.js';
import { resourceName, standardTags } from '../naming.js';

export interface IdentityStackProps {
  readonly env: EnvironmentConfig;
  /** GitHub repository in `owner/repo` form (OIDC subject). */
  readonly githubRepository?: string;
}

/**
 * OPS-04 identity foundation (ADR-024 accepted): GitHub OIDC provider + one
 * per-environment CI role. The role assumes AWS via OIDC with `aud` pinned to
 * sts.amazonaws.com and `sub` pinned to `repo:<owner>/<repo>:environment:<env>`
 * (short-lived identity, no long-term AWS access keys, production role separate
 * from non-production). Actual deployment permissions are scoped in OPS-05.
 */
export class IdentityStack extends Stack {
  public readonly provider: iam.OpenIdConnectProvider;
  public readonly ciRole: iam.Role;

  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    const { env, githubRepository = 'GehrmannMerlin/Aurora' } = props;
    super(scope, id, { env: { account: env.account, region: env.region } });

    this.provider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    this.ciRole = new iam.Role(this, 'CiRole', {
      roleName: resourceName(env, 'iam', 'ci'),
      assumedBy: new iam.OpenIdConnectPrincipal(this.provider, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${githubRepository}:environment:${env.name}`,
        },
      }),
    });

    for (const [key, value] of Object.entries(standardTags(env))) {
      Tags.of(this).add(key, value);
    }
  }
}
