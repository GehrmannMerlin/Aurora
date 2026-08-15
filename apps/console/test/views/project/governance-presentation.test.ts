import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const accessSource = readFileSync('src/views/project/ProjectAccessView.vue', 'utf8');
const clientKeysSource = readFileSync('src/views/project/ProjectClientKeysView.vue', 'utf8');
const settingsSource = readFileSync('src/views/project/ProjectSettingsView.vue', 'utf8');
const lifecycleSource = readFileSync('src/views/project/ProjectLifecycleView.vue', 'utf8');

describe('project governance workspace presentation', () => {
  it('keeps one effective member per table row with role and source as separate evidence', () => {
    expect(accessSource).toContain('class="governance-table"');
    expect(accessSource).toContain('data-testid="access-members-table"');
    expect(accessSource).toContain('data-testid="member-effective-role"');
    expect(accessSource).toContain('data-testid="member-role-source"');
  });

  it('uses a key list with a selected detail inspector instead of a card grid', () => {
    expect(clientKeysSource).toContain('class="key-workspace"');
    expect(clientKeysSource).toContain('data-testid="client-key-list-table"');
    expect(clientKeysSource).toContain('data-testid="client-key-detail"');
    expect(clientKeysSource).toContain('data-testid="client-key-secret-delivery"');
    expect(clientKeysSource).not.toContain('class="mon-key-list"');
  });

  it('keeps project settings and environments as independently restorable workspaces', () => {
    expect(settingsSource).toContain('data-testid="settings-general-workspace"');
    expect(settingsSource).toContain('data-testid="settings-environments-workspace"');
    expect(settingsSource).toContain("raw === 'environments' ? 'environments' : 'general'");
    expect(settingsSource).toContain('data-testid="settings-environment-table"');
  });

  it('isolates archive and deletion commands into distinct lifecycle danger surfaces', () => {
    expect(lifecycleSource).toContain('data-testid="lifecycle-archive-zone"');
    expect(lifecycleSource).toContain('data-testid="lifecycle-delete-zone"');
    expect(lifecycleSource).toContain('data-testid="lifecycle-trash-name"');
    expect(lifecycleSource).toContain(
      'class="lifecycle-danger-zone lifecycle-danger-zone--archive"',
    );
  });
});
