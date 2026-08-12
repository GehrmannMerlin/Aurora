export {
  PlatformReleasesError,
  type PlatformReleasesErrorKind,
} from './errors.js';
export { withTransaction } from './repositories/transaction.js';
export { normalizeBuildPath } from './build-path.js';
export {
  InMemorySourceMapObjectStorage,
  sourceMapObjectKey,
  type SourceMapObjectStoragePort,
} from './source-map-object-storage.js';
export {
  parseSourceMapV3,
  resolveSourcePosition,
  decodeMappings,
  decodeVlqValue,
  type SourceMapV3,
  type SourceMapParseResult,
  type DecodedSegment,
  type ResolvedSourcePosition,
} from './source-map-parser.js';
export {
  upsertRelease,
  listReleases,
  getReleaseById,
  type ReleaseRow,
} from './releases-repository.js';
export {
  createSourceMapFile,
  replaceSourceMapFile,
  listSourceMapFiles,
  getSourceMapFileById,
  createReparseTask,
  claimPendingReparseTasks,
  updateReparseTaskProgress,
  completeReparseTask,
  failReparseTask,
  type SourceMapFileRow,
  type ReparseTaskRow,
} from './source-map-repository.js';
