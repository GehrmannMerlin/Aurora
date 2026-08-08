/**
 * Nearest-rank percentile over ascending numeric samples.
 * Percentile p(q) = sorted[ceil((q/100) * n)] (1-indexed).
 * Empty samples fail explicitly; NaN is never silently returned.
 */
export function percentile(sortedAsc: readonly number[], q: number): number {
  if (sortedAsc.length === 0) {
    throw new Error('percentile called on an empty sample');
  }
  if (!Number.isFinite(q) || q < 0 || q > 100) {
    throw new Error(`invalid percentile quantile: ${String(q)}`);
  }
  const rank = Math.ceil((q / 100) * sortedAsc.length);
  const index = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  const value = sortedAsc[index];
  if (value === undefined) {
    throw new Error(`percentile index out of range: ${String(index)}`);
  }
  return value;
}

export function sortNumbersAscending(input: readonly number[]): number[] {
  return [...input].sort((a, b) => a - b);
}
