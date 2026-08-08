export type ScopeKey =
  | { readonly type: 'public' }
  | { readonly type: 'account' }
  | { readonly type: 'workspace' }
  | { readonly type: 'organization'; readonly id: string }
  | { readonly type: 'project'; readonly id: string };

export function scopeKeyString(scope: ScopeKey): string {
  switch (scope.type) {
    case 'organization':
      return `organization:${scope.id}`;
    case 'project':
      return `project:${scope.id}`;
    default:
      return scope.type;
  }
}
