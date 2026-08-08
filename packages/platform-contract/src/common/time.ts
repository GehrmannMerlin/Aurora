import { z } from 'zod';
import { obj, str } from './schema.js';

const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const utcTimestampZod = z
  .string()
  .min(20)
  .max(24)
  .refine((v) => rfc3339.test(v), { message: 'must be RFC 3339 UTC' });

export const utcTimestamp = {
  zod: utcTimestampZod,
  openapi: { type: 'string', format: 'date-time' },
  meta: {},
};

export const timeRange = obj({
  start: utcTimestamp,
  end: utcTimestamp,
});

export const businessCalendarBoundary = obj({
  ianaTimezone: str(1, 64),
  utcStart: utcTimestamp,
  utcEnd: utcTimestamp,
});

export const readAt = utcTimestamp;
