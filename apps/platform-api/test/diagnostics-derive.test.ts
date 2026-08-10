import { describe, expect, it } from 'vitest';
import {
  deriveActionTargets,
  deriveDiagnosisSummary,
  type DiagnosisSummaryInput,
} from '../src/routes/diagnostics.js';

const ORG = '11111111-1111-1111-1111-111111111111';
const PROJECT = '22222222-2222-2222-2222-222222222222';

function input(overrides: Partial<DiagnosisSummaryInput> = {}): DiagnosisSummaryInput {
  return {
    activeCount: 1,
    disabledCount: 0,
    revokedCount: 0,
    receivedCount: 0,
    processingCount: 0,
    processedCount: 0,
    ...overrides,
  };
}

describe('deriveDiagnosisSummary (spec §5.3 priority order)', () => {
  it('blocked/credential_inactive when credentials exist but none is active', () => {
    expect(
      deriveDiagnosisSummary(input({ activeCount: 0, disabledCount: 2, receivedCount: 5 })),
    ).toEqual({ status: 'blocked', primaryCause: 'credential_inactive' });
    expect(
      deriveDiagnosisSummary(input({ activeCount: 0, revokedCount: 1, receivedCount: 5 })),
    ).toEqual({ status: 'blocked', primaryCause: 'credential_inactive' });
  });

  it('not_receiving/no_credential when no credentials exist', () => {
    expect(
      deriveDiagnosisSummary(input({ activeCount: 0, disabledCount: 0, revokedCount: 0 })),
    ).toEqual({ status: 'not_receiving', primaryCause: 'no_credential' });
  });

  it('not_receiving/no_received_events when credentials exist but the window has no rows', () => {
    expect(deriveDiagnosisSummary(input({ receivedCount: 0 }))).toEqual({
      status: 'not_receiving',
      primaryCause: 'no_received_events',
    });
  });

  it('processing/processing_backlog when processingCount > 0 (even with processed rows)', () => {
    expect(
      deriveDiagnosisSummary(input({ receivedCount: 5, processingCount: 1, processedCount: 2 })),
    ).toEqual({ status: 'processing', primaryCause: 'processing_backlog' });
  });

  it('receiving (no primaryCause) when processedCount > 0 and nothing is processing', () => {
    expect(deriveDiagnosisSummary(input({ receivedCount: 3, processedCount: 3 }))).toEqual({
      status: 'receiving',
    });
  });

  it('unknown when the window holds rows but nothing processed or processing', () => {
    expect(
      deriveDiagnosisSummary(input({ receivedCount: 2, processingCount: 0, processedCount: 0 })),
    ).toEqual({ status: 'unknown' });
  });
});

describe('deriveActionTargets (spec §5.3 closed mapping)', () => {
  it('blocked → project.client-keys', () => {
    expect(
      deriveActionTargets({ status: 'blocked', primaryCause: 'credential_inactive' }, ORG, PROJECT),
    ).toEqual([
      {
        routeId: 'project.client-keys',
        pathParams: { organizationId: ORG, projectId: PROJECT },
        query: {},
      },
    ]);
  });

  it('not_receiving (either cause) → project.onboarding', () => {
    for (const cause of ['no_credential', 'no_received_events'] as const) {
      expect(
        deriveActionTargets({ status: 'not_receiving', primaryCause: cause }, ORG, PROJECT),
      ).toEqual([
        {
          routeId: 'project.onboarding',
          pathParams: { organizationId: ORG, projectId: PROJECT },
          query: {},
        },
      ]);
    }
  });

  it('processing and receiving → project.requests + project.performance', () => {
    expect(
      deriveActionTargets(
        { status: 'processing', primaryCause: 'processing_backlog' },
        ORG,
        PROJECT,
      ),
    ).toEqual([
      {
        routeId: 'project.requests',
        pathParams: { organizationId: ORG, projectId: PROJECT },
        query: {},
      },
      {
        routeId: 'project.performance',
        pathParams: { organizationId: ORG, projectId: PROJECT },
        query: {},
      },
    ]);
    expect(deriveActionTargets({ status: 'receiving' }, ORG, PROJECT)).toEqual([
      {
        routeId: 'project.requests',
        pathParams: { organizationId: ORG, projectId: PROJECT },
        query: {},
      },
      {
        routeId: 'project.performance',
        pathParams: { organizationId: ORG, projectId: PROJECT },
        query: {},
      },
    ]);
  });

  it('unknown → no action targets', () => {
    expect(deriveActionTargets({ status: 'unknown' }, ORG, PROJECT)).toEqual([]);
  });
});
