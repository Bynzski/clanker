import { describe, expect, it } from 'vitest';
import { getWorkspaceRenameValue as rename } from '../../../src/renderer/lib/workspaceLabels';

const base = { gitCurrentBranch: null, environmentId: 'local' };

describe('getWorkspaceRenameValue', () => {
  it('uses the workspace name for normal workspaces', () => {
    expect(rename({ ...base, name: 'My WS', workspacePath: '/p/repo' })).toBe('My WS');
  });
  it('falls back to the project name when the name is empty', () => {
    expect(rename({ ...base, name: '', workspacePath: '/p/repo' })).toBe('repo');
  });
  it('uses the project name for a linked worktree with a generated name', () => {
    expect(rename({
      ...base, name: 'repo-abc', workspacePath: '/p/repo-worktrees/repo-abc', isLinkedWorktree: true, projectName: 'repo',
    })).toBe('repo');
  });
});
