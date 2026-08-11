export const up = (pgm) => {
  // NOT forward-compatible: destructive DDL in an up-migration
  pgm.dropTable('events');
  pgm.dropColumn('events', 'legacy_column');
};
export const down = () => {
  // no-op down
};
