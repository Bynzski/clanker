import { describe, expect, it, vi } from 'vitest';
import { isCanonicalProvenancePath, MAX_PROVENANCE_REPOSITORIES, MAX_PROVENANCE_WORKTREES, WorktreeProvenance } from '../../../src/main/worktreeProvenance';

describe('WorktreeProvenance', () => {
  it('remembers per environment and repository, keeps a known branch when a later listing has none, and skips the main checkout', () => {
    const write = vi.fn();
    const provenance = new WorktreeProvenance({ read: () => [], write });
    provenance.remember('local', '/p/app', [{ path: '/p/app-a', branch: 'a' }, { path: '/p/app', branch: 'main' }]);
    provenance.remember('local', '/p/app', [{ path: '/p/app-a', branch: null }]);
    expect(provenance.recall('local', '/p/app')).toEqual([{ path: '/p/app-a', branch: 'a' }]);
    expect(provenance.recall('ssh-a', '/p/app')).toEqual([]);
    expect(provenance.recall('local', '/p/other')).toEqual([]);
    // The unchanged re-observation did not rewrite the store.
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('reads back what it wrote and survives damaged or hostile stored data', () => {
    let stored: unknown;
    const first = new WorktreeProvenance({ read: () => stored, write: (records) => { stored = JSON.parse(JSON.stringify(records)); } });
    first.remember('local', '/p/app', [{ path: '/p/app-a', branch: 'a' }]);
    expect(new WorktreeProvenance({ read: () => stored, write: () => undefined }).recall('local', '/p/app')).toEqual([{ path: '/p/app-a', branch: 'a' }]);
    for (const bad of [null, 'x', 5, [null, 1, { environmentId: 5 }, { environmentId: 'local', mainPath: 'relative', worktrees: [] }]]) {
      expect(new WorktreeProvenance({ read: () => bad, write: () => undefined }).recall('local', '/p/app')).toEqual([]);
    }
    expect(new WorktreeProvenance({ read: () => { throw new Error('boom'); }, write: () => undefined }).recall('local', '/p')).toEqual([]);
    const filtered = new WorktreeProvenance({
      read: () => [{ environmentId: 'local', mainPath: '/p/app', worktrees: [{ path: 'relative' }, { path: '/ok', branch: 5 }, { path: '/good', branch: null }] }],
      write: () => undefined,
    });
    expect(filtered.recall('local', '/p/app')).toEqual([{ path: '/good', branch: null }]);
  });

  it('stays bounded, dropping the least recently seen first, and tolerates a failing store', () => {
    const provenance = new WorktreeProvenance({ read: () => [], write: () => { throw new Error('disk full'); } });
    for (let index = 0; index < MAX_PROVENANCE_REPOSITORIES + 3; index++) {
      provenance.remember('local', `/r/${index}`, [{ path: `/r/${index}-wt`, branch: null }]);
    }
    expect(provenance.recall('local', '/r/0')).toEqual([]);
    expect(provenance.recall('local', `/r/${MAX_PROVENANCE_REPOSITORIES + 2}`)).toHaveLength(1);
    provenance.remember('local', '/big', Array.from({ length: MAX_PROVENANCE_WORKTREES + 10 }, (_, index) => ({ path: `/big-${index}`, branch: null })));
    const kept = provenance.recall('local', '/big');
    expect(kept).toHaveLength(MAX_PROVENANCE_WORKTREES);
    expect(kept[kept.length - 1].path).toBe(`/big-${MAX_PROVENANCE_WORKTREES + 9}`);
  });

  describe('canonical Windows and UNC paths (platform independent)', () => {
    it.each(['/srv/repo', 'C:/repo', 'c:/Users/me/repo-worktrees/feat-1', 'D:/', '//server/share/repo', '//server/share'])('accepts %s', (value) => {
      expect(isCanonicalProvenancePath(value)).toBe(true);
    });
    it.each(['', 'relative/path', 'C:', 'C:repo', 'C:\\repo', '//server', '///x', '//server/', '/a/../b', 'C:/a/../b', '/a/./b', 'a\u0000b', '/a\nb', 'C:/a\u007fb', `/${'x'.repeat(4100)}`, 5, null])('rejects %j', (value) => {
      expect(isCanonicalProvenancePath(value)).toBe(false);
    });

    it('remembers Windows generated and adopted worktrees, rebuilds them from storage and recalls them', () => {
      let stored: unknown = [];
      const write = (records: unknown) => { stored = JSON.parse(JSON.stringify(records)); };
      const first = new WorktreeProvenance({ read: () => stored, write });
      first.remember('local', 'C:/work/app', [
        { path: 'C:/work/app-worktrees/feat-9b5caa85b1e5d269b239', branch: 'feat' }, { path: 'C:/work/app-sibling', branch: 'sib' },
        { path: '//nas/share/app-wt', branch: null }, { path: 'C:\\bad\\path', branch: 'x' }, { path: 'rel', branch: 'y' },
      ]);
      first.remember('local', '//nas/share/app', [{ path: '//nas/share/app-wt2', branch: 'u' }]);
      const second = new WorktreeProvenance({ read: () => stored, write });
      expect(second.recall('local', 'C:/work/app')).toEqual([
        { path: 'C:/work/app-worktrees/feat-9b5caa85b1e5d269b239', branch: 'feat' }, { path: 'C:/work/app-sibling', branch: 'sib' },
        { path: '//nas/share/app-wt', branch: null },
      ]);
      expect(second.recall('local', '//nas/share/app')).toEqual([{ path: '//nas/share/app-wt2', branch: 'u' }]);
      // A malformed repository key is refused outright, not stored.
      second.remember('local', 'C:repo', [{ path: 'C:/x', branch: null }]);
      expect(second.recall('local', 'C:repo')).toEqual([]);
    });
  });
});
