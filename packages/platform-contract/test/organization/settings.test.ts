import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_UPDATE_TIMEZONE,
  organizationUpdateTimezoneRequest,
  organizationUpdateTimezoneResponse,
} from '../../src/organization/settings.js';

describe('organizationUpdateTimezone contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_UPDATE_TIMEZONE).toBe('organizationUpdateTimezone');
  });

  it('accepts a valid timezone request', () => {
    expect(
      organizationUpdateTimezoneRequest.zod.safeParse({
        timezone: 'Asia/Shanghai',
        resourceVersion: 'v1',
      }).success,
    ).toBe(true);
  });

  it('rejects a missing resourceVersion', () => {
    expect(organizationUpdateTimezoneRequest.zod.safeParse({ timezone: 'UTC' }).success).toBe(
      false,
    );
  });

  it('rejects a missing timezone', () => {
    expect(organizationUpdateTimezoneRequest.zod.safeParse({ resourceVersion: 'v1' }).success).toBe(
      false,
    );
  });

  it('rejects an undeclared field (closed object)', () => {
    expect(
      organizationUpdateTimezoneRequest.zod.safeParse({
        timezone: 'UTC',
        resourceVersion: 'v1',
        organizationId: 'org_1',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid timezone response', () => {
    expect(
      organizationUpdateTimezoneResponse.zod.safeParse({
        organizationId: 'org_1',
        timezone: 'Asia/Shanghai',
        resourceVersion: 'v1',
      }).success,
    ).toBe(true);
  });
});
