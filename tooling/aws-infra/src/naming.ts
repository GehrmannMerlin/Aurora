/**
 * OPS-04 resource naming and standard tags (deployment.md §4).
 *
 * Every provisioned resource must carry at least:
 * system, environment, Owner, data-classification, cost-center, managed-by.
 * Names use the `aurora-<env>-<type>-<id>` convention so resources are
 * identifiable and cost-allocatable across both AWS accounts.
 */

export const OWNER_TAG_VALUE = 'aurora-cloud-ops';

export function resourceName(env: { readonly name: string }, type: string, id: string): string {
  return `aurora-${env.name}-${type}-${id}`;
}

export function standardTags(env: {
  readonly name: string;
  readonly isProduction: boolean;
}): Record<string, string> {
  return {
    system: 'aurora',
    environment: env.name,
    Owner: OWNER_TAG_VALUE,
    'data-classification': env.isProduction ? 'confidential' : 'internal',
    'cost-center': 'aurora-monitoring',
    'managed-by': 'cdk',
  };
}
