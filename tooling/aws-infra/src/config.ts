/**
 * OPS-04 environment / account / region contract.
 *
 * Frozen decisions (ADR-022, accepted 2026-08-11):
 * - AWS dual-account model: non-production (staging/CI/PR) + production.
 * - Primary region default: ap-southeast-1 (OPS-04 default, revisitable before provisioning).
 * - Account IDs are environment inputs (env var override), never hard-coded real IDs.
 *
 * `resolveEnvironmentConfig` is safe for `cdk synth` (placeholders allowed so synthesis
 * needs no credentials). `assertDeployable` guards real provisioning: it throws on
 * placeholder / malformed accounts so a deploy can never target a placeholder.
 */

export type EnvironmentName = 'staging' | 'production';

export interface EnvironmentConfig {
  readonly name: EnvironmentName;
  readonly isProduction: boolean;
  readonly account: string;
  readonly region: string;
}

export const AURORA_ENVIRONMENTS: readonly EnvironmentName[] = ['staging', 'production'];

export const DEFAULT_PRIMARY_REGION = 'ap-southeast-1';

/** Placeholder account ids: replace via AURORA_<ENV>_ACCOUNT before any deploy. */
const PLACEHOLDER_ACCOUNTS: Readonly<Record<EnvironmentName, string>> = {
  staging: '111111111111',
  production: '222222222222',
};

const ACCOUNT_ID_PATTERN = /^\d{12}$/;

export function resolveEnvironmentConfig(
  name: EnvironmentName,
  overrides?: Partial<Pick<EnvironmentConfig, 'account' | 'region'>>,
): EnvironmentConfig {
  const envVarAccount = process.env[`AURORA_${name.toUpperCase()}_ACCOUNT`];
  const envVarRegion = process.env[`AURORA_${name.toUpperCase()}_REGION`];
  const account = overrides?.account ?? envVarAccount ?? PLACEHOLDER_ACCOUNTS[name];
  const region = overrides?.region ?? envVarRegion ?? DEFAULT_PRIMARY_REGION;
  return Object.freeze({ name, isProduction: name === 'production', account, region });
}

export function assertDeployable(env: EnvironmentConfig): void {
  if (Object.values(PLACEHOLDER_ACCOUNTS).includes(env.account)) {
    throw new Error(
      `invalid_account_placeholder: environment ${env.name} still uses placeholder account ${env.account}; set AURORA_${env.name.toUpperCase()}_ACCOUNT before deploying`,
    );
  }
  if (!ACCOUNT_ID_PATTERN.test(env.account)) {
    throw new Error(
      `invalid_account_format: environment ${env.name} account "${env.account}" is not a 12-digit AWS account id`,
    );
  }
}
