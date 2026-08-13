/**
 * Deterministic, conservative Error.stack frame extraction (PRD §8.3.2 — strict
 * matching, never fuzzy). Only lines that match one of the two canonical V8
 * frame shapes are parsed; everything else is skipped. A wrongly-parsed frame
 * simply fails to match a build path (no false symbolication).
 */

export interface StackFrame {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly functionName: string | null;
}

const FRAME_WITH_FUNCTION = /^at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/;
const FRAME_WITHOUT_FUNCTION = /^at\s+(.+?):(\d+):(\d+)$/;

function stripAsyncPrefix(fn: string | null): string | null {
  if (fn === null) return null;
  return fn.replace(/^async\s+/, '');
}

/** Extract frames from a stack string; unmatched lines are ignored. */
export function extractStackFrames(stack: string): readonly StackFrame[] {
  const frames: StackFrame[] = [];
  for (const rawLine of stack.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const withFunction = FRAME_WITH_FUNCTION.exec(line);
    if (withFunction !== null) {
      frames.push({
        functionName: stripAsyncPrefix(withFunction[1] ?? null),
        file: withFunction[2] ?? '',
        line: Number(withFunction[3]),
        column: Number(withFunction[4]),
      });
      continue;
    }
    const withoutFunction = FRAME_WITHOUT_FUNCTION.exec(line);
    if (withoutFunction !== null) {
      frames.push({
        functionName: null,
        file: withoutFunction[1] ?? '',
        line: Number(withoutFunction[2]),
        column: Number(withoutFunction[3]),
      });
    }
  }
  return frames;
}
