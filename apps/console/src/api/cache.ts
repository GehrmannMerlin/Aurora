import type { ScopeKey } from './scope.js';
import { scopeKeyString } from './scope.js';

export interface CachedValue<T> {
  readonly data: T;
  readonly readAt: string;
  readonly scope: ScopeKey;
}

export class RequestCache {
  private readonly store = new Map<string, CachedValue<unknown>>();

  get<T>(key: string): CachedValue<T> | undefined {
    return this.store.get(key) as CachedValue<T> | undefined;
  }

  set<T>(key: string, data: T, scope: ScopeKey): void {
    this.store.set(key, { data, readAt: new Date().toISOString(), scope });
  }

  invalidateScope(scope: ScopeKey): void {
    const prefix = `${scopeKeyString(scope)}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  invalidateKey(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const requestCache = new RequestCache();
