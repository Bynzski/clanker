import { describe, expect, it } from 'vitest';
import { canRemoveWorktree, parseWorktreeChanges, validateWorktreeChanges } from '../../../src/main/worktreeChanges';

describe('worktree change detail', () => {
  it('classifies NUL records, consuming renamed source paths and preserving unusual filenames', () => {
    expect(parseWorktreeChanges('R  new\0!! old\0?? untracked\nfile\0!! node_modules/\0 M tracked\0')).toEqual({
      tracked: { count: 2, paths: ['new', 'tracked'] }, untracked: { count: 1, paths: ['untracked\nfile'] },
      ignored: { count: 1, paths: ['node_modules/'] },
    });
  });
  it('caps examples while retaining counts', () => {
    const result = parseWorktreeChanges(Array.from({ length: 30 }, (_, index) => `?? file${index}\0`).join(''));
    expect(result.untracked.count).toBe(30);
    expect(result.untracked.paths).toHaveLength(20);
  });
  it('fails closed for absent or inconsistent detail and outside paths', () => {
    expect(canRemoveWorktree({ success: true, hasChanges: true }, true)).toBe(false);
    expect(canRemoveWorktree({ success: true }, true)).toBe(false);
    expect(() => validateWorktreeChanges(parseWorktreeChanges(''), true)).toThrow();
    expect(() => parseWorktreeChanges('?? ../outside\0')).toThrow();
    expect(() => parseWorktreeChanges('R  new\0')).toThrow();
    const changes = parseWorktreeChanges('!! ignored\0');
    expect(canRemoveWorktree({ success: true, hasChanges: true, changes }, false)).toBe(false);
    expect(canRemoveWorktree({ success: true, hasChanges: true, changes }, true)).toBe(true);
    changes.ignored.paths = ['/outside'];
    expect(() => validateWorktreeChanges(changes, true)).toThrow();
  });
});
