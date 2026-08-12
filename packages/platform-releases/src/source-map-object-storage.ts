/**
 * Private Source Map object-storage port (platform backend §9.3 / accepted
 * ADR-032). Production uses a private S3-compatible store; this package ships
 * a disposable in-memory adapter for tests/dev. Object keys are unguessable
 * internal identifiers, never the raw uploaded path.
 */
export interface SourceMapObjectStoragePort {
  putObject(input: { readonly key: string; readonly content: string }): Promise<void>;
  getObject(key: string): Promise<string | null>;
  deleteObject(key: string): Promise<void>;
}

/** Deterministic unguessable object key (never concatenates the upload path). */
export function sourceMapObjectKey(projectId: string, objectId: string): string {
  return `aurora-sourcemaps/${projectId}/${objectId}.map`;
}

/** Disposable in-memory adapter for tests/dev (NOT a multi-process production path). */
export class InMemorySourceMapObjectStorage implements SourceMapObjectStoragePort {
  private readonly objects = new Map<string, string>();

  async putObject(input: { readonly key: string; readonly content: string }): Promise<void> {
    this.objects.set(input.key, input.content);
  }

  async getObject(key: string): Promise<string | null> {
    return this.objects.get(key) ?? null;
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
