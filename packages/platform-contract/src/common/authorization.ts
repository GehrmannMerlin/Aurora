import { arr, enum_ } from './schema.js';

export const allowedActions = arr(
  enum_(['create', 'read', 'update', 'delete', 'manage', 'restore', 'transfer', 'revoke']),
  0,
  32,
);

export type Capability = string;
