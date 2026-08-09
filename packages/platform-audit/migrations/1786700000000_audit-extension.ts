import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * PLT-04 platform-audit data layer migration.
 *
 * Extends the PLT-03 `security_audit_events` table (created by the
 * platform-identity migration, which this migration assumes has already run)
 * for the B7 read-only security timeline (spec §4.6):
 * - `project_id` (uuid, nullable): a TOMBSTONE reference to a project, NOT an
 *   FK. Audit rows must survive permanent project deletion, so no foreign key
 *   points at `projects`; a permanently deleted project leaves a bare uuid that
 *   no longer matches any `projects` row. The read repository surfaces it as
 *   `targetProjectRef` without requiring the project to exist.
 * - `result` (text, nullable): the contract `result` enum
 *   ('succeeded'/'failed'/'blocked'); NULL (rows written before this extension,
 *   or by a writer that does not set it) is surfaced by the repository as the
 *   stable default 'succeeded'.
 * - index on `(organization_id, occurred_at DESC)`: the B7 timeline query
 *   (`WHERE organization_id = $1 ORDER BY occurred_at DESC`).
 *
 * Up/down fully reversible: `down` drops the index, the result CHECK and both
 * columns, leaving the PLT-03 table intact.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumns('security_audit_events', {
    project_id: { type: 'uuid' },
    result: { type: 'text' },
  });
  pgm.addConstraint('security_audit_events', 'ck_security_audit_events_result', {
    check: "result IS NULL OR result IN ('succeeded','failed','blocked')",
  });
  pgm.createIndex(
    'security_audit_events',
    ['organization_id', { name: 'occurred_at', sort: 'DESC' }],
    { name: 'idx_security_audit_events_org_occurred_at' },
  );
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropIndex(
    'security_audit_events',
    ['organization_id', { name: 'occurred_at', sort: 'DESC' }],
    { name: 'idx_security_audit_events_org_occurred_at' },
  );
  pgm.dropConstraint('security_audit_events', 'ck_security_audit_events_result');
  pgm.dropColumns('security_audit_events', ['project_id', 'result']);
};
