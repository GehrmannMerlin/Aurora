import type { Component } from 'vue';
import type { z } from 'zod';
import type { RouteTargetId } from '@aurora/platform-contract';

export type RouteScope =
  'public' | 'account' | 'workspace' | 'organization' | 'project' | 'platform';

export type UnavailableReason =
  'capability-not-provided' | 'dependency-unavailable' | 'permission-unavailable';

export interface RouteEntry {
  readonly routeId: RouteTargetId;
  readonly path: string;
  readonly scope: RouteScope;
  readonly label: string;
  readonly parent?: RouteTargetId;
  readonly paramsSchema: z.ZodType;
  readonly querySchema: z.ZodType;
  readonly lazy: () => Promise<Component>;
  readonly menu: boolean;
  readonly unavailableReason: UnavailableReason | null;
}

export type ResolveResult =
  | { readonly path: string; readonly error?: undefined }
  | { readonly path: undefined; readonly error: 'unknown-target' | 'invalid-params' };
