import { describe, expect, it } from 'vitest';
import {
  AURORA_ENVIRONMENTS,
  DEFAULT_PRIMARY_REGION,
  assertDeployable,
  resolveEnvironmentConfig,
} from '../src/config.js';
import { OWNER_TAG_VALUE, resourceName, standardTags } from '../src/naming.js';

describe('environment/account/region contract', () => {
  it('defines staging as non-production and production as production', () => {
    expect(AURORA_ENVIRONMENTS).toEqual(['staging', 'production']);
    expect(resolveEnvironmentConfig('staging').isProduction).toBe(false);
    expect(resolveEnvironmentConfig('production').isProduction).toBe(true);
  });

  it('defaults to the ap-southeast-1 primary region', () => {
    expect(DEFAULT_PRIMARY_REGION).toBe('ap-southeast-1');
    expect(resolveEnvironmentConfig('staging').region).toBe('ap-southeast-1');
    expect(resolveEnvironmentConfig('production').region).toBe('ap-southeast-1');
  });

  it('allows account and region overrides', () => {
    const env = resolveEnvironmentConfig('production', {
      account: '123456789012',
      region: 'ap-east-1',
    });
    expect(env.account).toBe('123456789012');
    expect(env.region).toBe('ap-east-1');
  });

  it('assertDeployable throws on placeholder accounts', () => {
    expect(() => {
      assertDeployable(resolveEnvironmentConfig('staging'));
    }).toThrow('invalid_account_placeholder');
    expect(() => {
      assertDeployable(resolveEnvironmentConfig('production'));
    }).toThrow('invalid_account_placeholder');
  });

  it('assertDeployable throws on malformed accounts', () => {
    expect(() => {
      assertDeployable(resolveEnvironmentConfig('production', { account: 'not-an-account' }));
    }).toThrow('invalid_account_format');
  });

  it('assertDeployable passes for a real 12-digit account', () => {
    const env = resolveEnvironmentConfig('production', { account: '123456789012' });
    expect(() => {
      assertDeployable(env);
    }).not.toThrow();
  });
});

describe('naming and tags', () => {
  it('builds resource names with the aurora-<env>-<type>-<id> convention', () => {
    expect(resourceName({ name: 'staging' }, 'vpc', 'main')).toBe('aurora-staging-vpc-main');
    expect(resourceName({ name: 'production' }, 'rds', 'primary')).toBe(
      'aurora-production-rds-primary',
    );
  });

  it('standard tags include the deployment.md §4 required keys', () => {
    const prod = standardTags({ name: 'production', isProduction: true });
    expect(prod.system).toBe('aurora');
    expect(prod.environment).toBe('production');
    expect(prod.Owner).toBe(OWNER_TAG_VALUE);
    expect(prod['data-classification']).toBe('confidential');
    expect(prod['cost-center']).toBe('aurora-monitoring');
    expect(prod['managed-by']).toBe('cdk');
    const staging = standardTags({ name: 'staging', isProduction: false });
    expect(staging['data-classification']).toBe('internal');
  });
});
