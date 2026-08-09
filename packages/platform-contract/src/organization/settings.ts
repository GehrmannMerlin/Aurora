import { obj, str } from '../common/schema.js';
import { resourceVersion } from '../common/command.js';
import { OrganizationId } from '../common/identifiers.js';

export const OPERATION_ID_UPDATE_TIMEZONE = 'organizationUpdateTimezone' as const;

export const organizationUpdateTimezonePathParams = obj({
  organizationId: OrganizationId,
});

// B4 org business timezone: optimistic concurrency via resourceVersion (412 on conflict).
export const organizationUpdateTimezoneRequest = obj({
  timezone: str(1, 64),
  resourceVersion,
});

export const organizationUpdateTimezoneResponse = obj({
  organizationId: OrganizationId,
  timezone: str(1, 64),
  resourceVersion,
});
