import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn('event_inbox', {
    lease_id: { type: 'uuid' },
  });
  pgm.addConstraint('event_inbox', 'ck_event_inbox_lease_consistency', {
    check:
      "(state = 'leased' AND lease_id IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR (state <> 'leased' AND lease_id IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL)",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropConstraint('event_inbox', 'ck_event_inbox_lease_consistency');
  pgm.dropColumn('event_inbox', 'lease_id');
};
