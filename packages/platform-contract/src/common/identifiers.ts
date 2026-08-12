import { brandedId } from './schema.js';

export const AccountId = brandedId<'AccountId'>('AccountId');
export const OrganizationId = brandedId<'OrganizationId'>('OrganizationId');
export const ProjectId = brandedId<'ProjectId'>('ProjectId');
export const EnvironmentId = brandedId<'EnvironmentId'>('EnvironmentId');
export const IssueId = brandedId<'IssueId'>('IssueId', 1);
export const ReleaseId = brandedId<'ReleaseId'>('ReleaseId');
export const SourceMapFileId = brandedId<'SourceMapFileId'>('SourceMapFileId');
// bigserial identifiers render as short decimal strings (e.g. "1"), so the
// minimum length is 1 (IssueId precedent).
export const AlertRuleId = brandedId<'AlertRuleId'>('AlertRuleId', 1);
export const AlertInstanceId = brandedId<'AlertInstanceId'>('AlertInstanceId', 1);
export const NotificationId = brandedId<'NotificationId'>('NotificationId');
export const OperationId = brandedId<'OperationId'>('OperationId');
export const InvitationId = brandedId<'InvitationId'>('InvitationId');
export const PrivateTokenId = brandedId<'PrivateTokenId'>('PrivateTokenId');
export const AuditEventId = brandedId<'AuditEventId'>('AuditEventId');
