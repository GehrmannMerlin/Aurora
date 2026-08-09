import type { Pool, PoolClient } from 'pg';
import { toStableError } from '../errors.js';
import { isoTimestamp } from './timestamp.js';
import { isPoolClient, withTransaction } from './transaction.js';

export type OnboardingStatus = 'not_started' | 'in_progress' | 'completed';

/** camelCase projection of a project_onboarding row. */
export interface OnboardingRow {
  readonly projectId: string;
  readonly status: OnboardingStatus;
  readonly currentStep: number;
  readonly firstRequestAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateOnboardingStatusInput {
  readonly projectId: string;
  readonly status: OnboardingStatus;
  readonly currentStep: number;
}

export type UpdateOnboardingStatusResult =
  | { readonly status: 'success'; readonly onboarding: OnboardingRow }
  | { readonly status: 'not_found' };

interface OnboardingRowShape {
  project_id: string;
  status: OnboardingStatus;
  current_step: number;
  first_request_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toOnboardingRow(row: OnboardingRowShape): OnboardingRow {
  return {
    projectId: row.project_id,
    status: row.status,
    currentStep: row.current_step,
    firstRequestAt: isoTimestamp(row.first_request_at),
    completedAt: isoTimestamp(row.completed_at),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

const ONBOARDING_SELECT = `
  SELECT project_id, status, current_step, first_request_at, completed_at, created_at, updated_at
  FROM project_onboarding
`;

/** Read a project's onboarding row; null when the project is absent. */
export async function getOnboarding(
  pool: Pool | PoolClient,
  projectId: string,
): Promise<OnboardingRow | null> {
  try {
    const result = await pool.query<OnboardingRowShape>(
      `${ONBOARDING_SELECT} WHERE project_id = $1`,
      [projectId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toOnboardingRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}

async function runUpdateOnboardingStatus(
  client: PoolClient,
  input: UpdateOnboardingStatusInput,
): Promise<UpdateOnboardingStatusResult> {
  const updated = await client.query<OnboardingRowShape>(
    `UPDATE project_onboarding
     SET status = $2,
         current_step = $3,
         completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END,
         updated_at = now()
     WHERE project_id = $1
     RETURNING project_id, status, current_step, first_request_at, completed_at, created_at, updated_at`,
    [input.projectId, input.status, input.currentStep],
  );
  const row = updated.rows[0];
  if (row === undefined) return { status: 'not_found' };
  return { status: 'success', onboarding: toOnboardingRow(row) };
}

/**
 * Advance a project's onboarding status and current step. `completed_at` is set
 * when the status moves to `completed` and is preserved otherwise. Transactional.
 */
export async function updateOnboardingStatus(
  pool: Pool | PoolClient,
  input: UpdateOnboardingStatusInput,
): Promise<UpdateOnboardingStatusResult> {
  try {
    return isPoolClient(pool)
      ? await runUpdateOnboardingStatus(pool, input)
      : await withTransaction(pool, (client) => runUpdateOnboardingStatus(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}
