export interface DriftFailure {
  readonly message: string;
}

export function formatDriftFailures(failures: readonly DriftFailure[]): string {
  if (failures.length === 0) return '';
  const lines = failures.map((failure) => `- ${failure.message}`).join('\n');
  return `Ingestion OpenAPI drift failures:\n${lines}`;
}
