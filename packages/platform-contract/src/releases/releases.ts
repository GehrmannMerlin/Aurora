import { arr, enum_, num, obj, optional, str } from '../common/schema.js';
import { queryResponse } from '../common/query.js';
import { sectionResult } from '../common/section.js';
import { utcTimestamp } from '../common/time.js';
import { OrganizationId, ProjectId, ReleaseId, SourceMapFileId } from '../common/identifiers.js';

/**
 * DAT-18 Release / Source Map contract (PRD §8, C8/C9).
 *
 * v1 release identity is created by an authorized source-map upload (the
 * upload upserts the release by version). Source Map content is stored through
 * the private object-storage port (never public); the original-file download
 * (short-term signed intent) is deferred. Strict matching by project + release
 * + normalized build path; no cross-version guessing.
 */

export const OPERATION_ID_RELEASES_LIST = 'releasesListReleases' as const;
export const OPERATION_ID_SOURCE_MAPS_LIST = 'sourceMapsListFiles' as const;
export const OPERATION_ID_SOURCE_MAPS_UPLOAD = 'sourceMapsUpload' as const;
export const OPERATION_ID_SOURCE_MAPS_REPLACE = 'sourceMapsReplace' as const;
export const OPERATION_ID_SOURCE_MAPS_REPARSE = 'sourceMapsReparse' as const;

export const SOURCE_MAP_STATUS = ['active', 'replaced'] as const;
export type SourceMapStatus = (typeof SOURCE_MAP_STATUS)[number];

export const SOURCE_MAP_REPARSE_STATE = ['queued', 'processing', 'completed', 'failed'] as const;
export type SourceMapReparseState = (typeof SOURCE_MAP_REPARSE_STATE)[number];

export const RELEASE_SOURCE = ['source_map_upload'] as const;
export type ReleaseSource = (typeof RELEASE_SOURCE)[number];

export const releaseSummary = obj({
  releaseId: ReleaseId,
  version: str(1, 256),
  source: enum_(RELEASE_SOURCE),
  firstSeenAt: utcTimestamp,
  sourceMapFileCount: num(0),
});

export const sourceMapFileSummary = obj({
  sourceMapFileId: SourceMapFileId,
  buildPath: str(1, 2048),
  digestPrefix: str(8, 16),
  status: enum_(SOURCE_MAP_STATUS),
  reparse: obj({
    state: enum_(SOURCE_MAP_REPARSE_STATE),
    processedCount: optional(num(0)),
    totalCount: optional(num(0)),
    updatedAt: optional(utcTimestamp),
  }),
  uploadedAt: utcTimestamp,
  replacedAt: optional(utcTimestamp),
  version: num(1),
});

export const releasesListReleasesPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const releasesListReleasesResponse = queryResponse(
  sectionResult(obj({ items: arr(releaseSummary, 0, 200) })),
);

export const sourceMapsListFilesPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
  releaseId: ReleaseId,
});

export const sourceMapsListFilesResponse = queryResponse(
  sectionResult(obj({ items: arr(sourceMapFileSummary, 0, 200) })),
);

export const sourceMapsUploadPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const sourceMapsUploadBody = obj({
  releaseVersion: str(1, 256),
  buildPath: str(1, 2048),
  content: str(1, 240000),
  digest: str(64, 64),
  buildId: optional(str(1, 128)),
  idempotencyKey: str(8, 128),
});

export const sourceMapsUploadResponse = obj({
  data: obj({
    status: enum_(['uploaded', 'duplicate', 'replace_conflict']),
    releaseId: ReleaseId,
    sourceMapFileId: optional(SourceMapFileId),
    currentDigest: optional(str(64, 64)),
    version: optional(num(1)),
  }),
});

export const sourceMapsReplacePathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
  releaseId: ReleaseId,
  sourceMapFileId: SourceMapFileId,
});

export const sourceMapsReplaceBody = obj({
  content: str(1, 240000),
  digest: str(64, 64),
  version: num(1),
  idempotencyKey: str(8, 128),
});

export const sourceMapsReplaceResponse = obj({
  data: obj({
    status: enum_(['replaced']),
    sourceMapFileId: SourceMapFileId,
    version: num(1),
  }),
});

export const sourceMapsReparsePathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
  releaseId: ReleaseId,
});

export const sourceMapsReparseBody = obj({
  idempotencyKey: str(8, 128),
});

export const sourceMapsReparseResponse = obj({
  data: obj({
    status: enum_(['queued']),
    releaseId: ReleaseId,
    taskCount: num(1),
  }),
});
