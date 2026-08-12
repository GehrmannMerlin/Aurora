import type { Pool } from 'pg';
import {
  claimPendingReparseTasks,
  completeReparseTask,
  failReparseTask,
  getSourceMapFileById,
  normalizeBuildPath,
  parseSourceMapV3,
  resolveSourcePosition,
  updateReparseTaskProgress,
  type SourceMapObjectStoragePort,
  type SourceMapV3,
} from '@aurora/platform-releases';
import {
  extractStackFrames,
  persistSymbolization,
  queryReparseCandidates,
} from '@aurora/processing-store';

export interface SourceMapReparseRoundInput {
  readonly pool: Pool;
  /** Private Source Map object storage (disposable in-memory adapter in tests/dev). */
  readonly objectStorage: SourceMapObjectStoragePort;
  /** Maximum reparse tasks claimed per round. */
  readonly maxTasks?: number;
  /** Maximum occurrences re-symbolized per task. */
  readonly maxOccurrences?: number;
}

export interface SourceMapReparseRoundResult {
  readonly processedTasks: number;
  readonly symbolizedOccurrences: number;
  readonly failedTasks: number;
}

/** Extract the stack string from a stored error body (`error.stack`). */
function extractStackFromBody(normalizedBody: unknown): string | null {
  if (typeof normalizedBody !== 'object' || normalizedBody === null) return null;
  const error = (normalizedBody as Record<string, unknown>).error;
  if (typeof error !== 'object' || error === null) return null;
  const stack = (error as Record<string, unknown>).stack;
  return typeof stack === 'string' ? stack : null;
}

/**
 * Symbolicate one candidate occurrence against a parsed map: find a frame whose
 * normalized file path strictly equals the map's build path (PRD §8.3.2), then
 * resolve the generated position. Returns null when no frame matches the build
 * path (the occurrence belongs to another file and is left for its own reparse).
 */
function symbolizeCandidate(
  map: SourceMapV3,
  buildPath: string,
  normalizedBody: unknown,
): {
  readonly status: 'symbolized' | 'not_found';
  readonly resolvedFile?: string;
  readonly resolvedLine?: number;
  readonly resolvedColumn?: number;
  readonly functionName?: string;
} | null {
  const stack = extractStackFromBody(normalizedBody);
  if (stack === null) return null;
  for (const frame of extractStackFrames(stack)) {
    if (normalizeBuildPath(frame.file) !== buildPath) continue;
    const position = resolveSourcePosition(map, frame.line, frame.column);
    if (position === null) return { status: 'not_found' };
    return {
      status: 'symbolized',
      resolvedFile: position.source,
      resolvedLine: position.line,
      resolvedColumn: position.column,
      ...(frame.functionName === null ? {} : { functionName: frame.functionName }),
    };
  }
  return null;
}

/**
 * Run one bounded Source Map reparse round (PRD §8.3.8): claim pending tasks,
 * load each map from private object storage, parse it, re-symbolize occurrences
 * that are unsymbolized or stale (older map version / different file), and
 * persist the resolved source positions. A single task failure never blocks the
 * rest of the round.
 */
export async function runSourceMapReparseRound(
  input: SourceMapReparseRoundInput,
): Promise<SourceMapReparseRoundResult> {
  const maxTasks = input.maxTasks ?? 10;
  const maxOccurrences = input.maxOccurrences ?? 500;
  const tasks = await claimPendingReparseTasks(input.pool, { limit: maxTasks });

  let processedTasks = 0;
  let symbolizedOccurrences = 0;
  let failedTasks = 0;

  for (const task of tasks) {
    try {
      const file = await getSourceMapFileById(input.pool, {
        projectId: task.projectId,
        sourceMapFileId: task.sourceMapFileId,
      });
      if (file === null) {
        await failReparseTask(input.pool, { taskId: task.id });
        failedTasks += 1;
        continue;
      }
      const content = await input.objectStorage.getObject(file.objectKey);
      if (content === null) {
        await failReparseTask(input.pool, { taskId: task.id });
        failedTasks += 1;
        continue;
      }
      const parsed = parseSourceMapV3(content);
      if (!parsed.ok) {
        await failReparseTask(input.pool, { taskId: task.id });
        failedTasks += 1;
        continue;
      }
      const candidates = await queryReparseCandidates(input.pool, {
        projectId: task.projectId,
        sourceMapFileId: file.id,
        mapVersion: file.version,
        limit: maxOccurrences,
      });
      await updateReparseTaskProgress(input.pool, {
        taskId: task.id,
        processedCount: 0,
        targetCount: candidates.length,
      });

      let matched = 0;
      for (const candidate of candidates) {
        const symbolization = symbolizeCandidate(
          parsed.map,
          file.buildPath,
          candidate.normalizedBody,
        );
        if (symbolization === null) continue;
        await persistSymbolization(input.pool, {
          occurrenceId: candidate.occurrenceId,
          projectId: task.projectId,
          releaseId: task.releaseId,
          sourceMapFileId: file.id,
          mapVersion: file.version,
          originalPath: file.buildPath,
          status: symbolization.status,
          ...(symbolization.resolvedFile === undefined
            ? {}
            : { resolvedFile: symbolization.resolvedFile }),
          ...(symbolization.resolvedLine === undefined
            ? {}
            : { resolvedLine: symbolization.resolvedLine }),
          ...(symbolization.resolvedColumn === undefined
            ? {}
            : { resolvedColumn: symbolization.resolvedColumn }),
          ...(symbolization.functionName === undefined
            ? {}
            : { functionName: symbolization.functionName }),
        });
        if (symbolization.status === 'symbolized') matched += 1;
      }
      await completeReparseTask(input.pool, { taskId: task.id });
      processedTasks += 1;
      symbolizedOccurrences += matched;
    } catch {
      await failReparseTask(input.pool, { taskId: task.id }).catch(() => undefined);
      failedTasks += 1;
    }
  }

  return { processedTasks, symbolizedOccurrences, failedTasks };
}
