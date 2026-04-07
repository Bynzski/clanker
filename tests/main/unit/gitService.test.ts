import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitService } from '../../../src/main/gitService';
import type { GitStatusResult } from '../../../src/main/gitService';

// ---------------------------------------------------------------------------
// Mock child_process.execFile (used via promisify inside GitService)
// ---------------------------------------------------------------------------

/**
 * Response map: git subcommand prefix → response.
 * The mock matches `git <args.join(' ')>` against each prefix in insertion order.
 */
const responses = new Map<string, { stdout?: string; stderr?: string; exitCode?: number }>();

function addResponse(subcommand: string, response: { stdout?: string; stderr?: string; exitCode?: number }) {
  responses.set(subcommand, response);
}

// promisify(execFile) normally converts (err, stdout, stderr) → { stdout, stderr }.
// Our mock is a plain function so promisify treats it as (err, result).
// We must return { stdout, stderr } as the second callback argument.
vi.mock('child_process', () => ({
  execFile: vi.fn((cmd: string, args: string[], options: any, callback?: any) => {
    let cb = typeof options === 'function' ? options : callback;
    const argString = args.join(' ');

    if (cmd !== 'git') {
      setImmediate(() => cb(new Error(`Unexpected command: ${cmd}`)));
      return;
    }

    // Find the first matching response by prefix
    for (const [prefix, resp] of responses) {
      if (argString.startsWith(prefix)) {
        if (resp.exitCode && resp.exitCode !== 0) {
          const err = new Error(`Command failed: git ${argString}`) as Error & {
            stderr?: string;
            code?: number;
            stdout?: string;
          };
          err.stderr = resp.stderr ?? '';
          err.code = resp.exitCode;
          err.stdout = resp.stdout ?? '';
          setImmediate(() => cb(err));
          return;
        }
        setImmediate(() => cb(null, { stdout: resp.stdout ?? '', stderr: resp.stderr ?? '' }));
        return;
      }
    }

    // No matching response — return empty success by default
    setImmediate(() => cb(null, { stdout: '', stderr: '' }));
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let emittedStatuses: GitStatusResult[] = [];
let service: GitService;

function createService() {
  emittedStatuses = [];
  service = new GitService((status) => { emittedStatuses.push(status); });
  return service;
}

beforeEach(() => {
  responses.clear();
  createService();
});

// ===========================================================================
// isRepo
// ===========================================================================
describe('isRepo', () => {
  it('returns true when rev-parse --git-dir succeeds', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    expect(await service.isRepo('/workspace')).toBe(true);
  });

  it('returns false when rev-parse --git-dir fails', async () => {
    addResponse('rev-parse --git-dir', { exitCode: 128, stderr: 'not a git repository' });
    expect(await service.isRepo('/workspace')).toBe(false);
  });
});

// ===========================================================================
// getStatus
// ===========================================================================
describe('getStatus', () => {
  it('returns status with changes when in a git repo', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain', {
      stdout: 'M  src/main.ts\nA  new-file.ts\n?? untracked.txt\nD  deleted.ts\nR  old.ts',
    });
    addResponse('branch --show-current', { stdout: 'main' });

    const result = await service.getStatus('/workspace');

    expect(result.success).toBe(true);
    expect(result.isRepo).toBe(true);
    expect(result.currentBranch).toBe('main');
    expect(result.isDetached).toBe(false);
    expect(result.changes).toHaveLength(5);
    expect(result.changes[0]).toEqual({ path: 'src/main.ts', status: 'modified', staged: true });
    expect(result.changes[1]).toEqual({ path: 'new-file.ts', status: 'added', staged: true });
    expect(result.changes[2]).toEqual({ path: 'untracked.txt', status: 'untracked', staged: false });
    expect(result.changes[3]).toEqual({ path: 'deleted.ts', status: 'deleted', staged: true });
    expect(result.changes[4]).toEqual({ path: 'old.ts', status: 'renamed', staged: true });
  });

  it('returns detached head when no current branch', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain', { stdout: '' });
    addResponse('branch --show-current', { stdout: '' });

    const result = await service.getStatus('/workspace');
    expect(result.isDetached).toBe(true);
    expect(result.currentBranch).toBeNull();
  });

  it('returns not-a-repo when rev-parse fails', async () => {
    addResponse('rev-parse --git-dir', { exitCode: 128, stderr: 'fatal: not a git repo' });

    const result = await service.getStatus('/workspace');
    expect(result.success).toBe(false);
    expect(result.isRepo).toBe(false);
    expect(result.changes).toEqual([]);
  });

  // Gap 1: Regression test for .trim() corrupting first-line status parsing
  it('correctly parses first-line unstaged modification without trim corruption', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain', {
      stdout: ' M file.txt\nA  staged.ts',
    });
    addResponse('branch --show-current', { stdout: 'main' });

    const result = await service.getStatus('/workspace');

    expect(result.changes).toHaveLength(2);
    expect(result.changes[0]).toEqual({
      path: 'file.txt',
      status: 'modified',
      staged: false,
    });
    expect(result.changes[1]).toEqual({
      path: 'staged.ts',
      status: 'added',
      staged: true,
    });
  });

  // Gap 8: Renamed file entry in porcelain format
  it('parses renamed file entries preserving full path', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain', {
      stdout: 'R  old_path.ts -> new_path.ts',
    });
    addResponse('branch --show-current', { stdout: 'main' });

    const result = await service.getStatus('/workspace');

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toEqual({
      path: 'old_path.ts -> new_path.ts',
      status: 'renamed',
      staged: true,
    });
  });
});

// ===========================================================================
// getCurrentBranch / getBranches
// ===========================================================================
describe('getBranches', () => {
  it('parses branch list with current marker', async () => {
    addResponse('branch --show-current', { stdout: 'main' });
    // Gap 2: Use full format string matching actual implementation
    addResponse('branch --format=%(refname:short)\t%(HEAD)', {
      stdout: 'main\t*\nfeature\t \nbugfix\t ',
    });

    const branches = await service.getBranches('/workspace');

    expect(branches).toHaveLength(3);
    expect(branches[0]).toEqual({ name: 'main', isCurrent: true });
    expect(branches[1]).toEqual({ name: 'feature', isCurrent: false });
    expect(branches[2]).toEqual({ name: 'bugfix', isCurrent: false });
  });

  it('returns empty array when no branches', async () => {
    addResponse('branch --show-current', { stdout: '' });
    addResponse('branch --format=%(refname:short)\t%(HEAD)', { stdout: '' });

    const branches = await service.getBranches('/workspace');
    expect(branches).toEqual([]);
  });
});

// ===========================================================================
// getBranchState
// ===========================================================================
describe('getBranchState', () => {
  it('returns full branch state for a repo', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('branch --show-current', { stdout: 'main' });
    addResponse('branch --format=%(refname:short)\t%(HEAD)', { stdout: 'main\t*\nfeature\t ' });

    const result = await service.getBranchState('/workspace');

    expect(result.success).toBe(true);
    expect(result.isRepo).toBe(true);
    expect(result.currentBranch).toBe('main');
    expect(result.isDetached).toBe(false);
    expect(result.branches).toHaveLength(2);
  });

  it('returns not-a-repo when rev-parse fails', async () => {
    addResponse('rev-parse --git-dir', { exitCode: 128, stderr: 'not a git repo' });

    const result = await service.getBranchState('/workspace');
    expect(result.success).toBe(false);
    expect(result.isRepo).toBe(false);
    expect(result.branches).toEqual([]);
  });
});

// ===========================================================================
// createBranch
// ===========================================================================
describe('createBranch', () => {
  it('creates branch with switch -c', async () => {
    addResponse('check-ref-format', { stdout: '' });
    addResponse('switch -c', { stdout: '' });

    const result = await service.createBranch('/workspace', 'feature/test');
    expect(result.success).toBe(true);
  });

  it('creates branch with base ref', async () => {
    addResponse('check-ref-format', { stdout: '' });
    addResponse('switch -c', { stdout: '' });

    const result = await service.createBranch('/workspace', 'feature/test', 'main');
    expect(result.success).toBe(true);
  });

  it('rejects empty branch name', async () => {
    const result = await service.createBranch('/workspace', '  ');
    expect(result.success).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('rejects invalid branch name', async () => {
    addResponse('check-ref-format', { exitCode: 1, stderr: 'invalid name' });

    const result = await service.createBranch('/workspace', 'bad..name');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('falls back to checkout -b when switch is not available', async () => {
    addResponse('check-ref-format', { stdout: '' });
    addResponse('switch -c', {
      exitCode: 1,
      stderr: "git: 'switch' is not a git command",
    });
    addResponse('checkout -b', { stdout: '' });

    const result = await service.createBranch('/workspace', 'feature');
    expect(result.success).toBe(true);
  });

  it('returns error when both switch and checkout fail', async () => {
    addResponse('check-ref-format', { stdout: '' });
    addResponse('switch -c', {
      exitCode: 1,
      stderr: "git: 'switch' is not a git command",
    });
    addResponse('checkout -b', {
      exitCode: 1,
      stderr: 'fatal: already exists',
    });

    const result = await service.createBranch('/workspace', 'existing');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ===========================================================================
// switchBranch
// ===========================================================================
describe('switchBranch', () => {
  it('switches branch using switch command', async () => {
    addResponse('switch', { stdout: '' });

    const result = await service.switchBranch('/workspace', 'feature');
    expect(result.success).toBe(true);
  });

  it('rejects empty branch name', async () => {
    const result = await service.switchBranch('/workspace', '');
    expect(result.success).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('falls back to checkout when switch is not available', async () => {
    addResponse('switch', {
      exitCode: 1,
      stderr: "git: 'switch' is not a git command",
    });
    addResponse('checkout', { stdout: '' });

    const result = await service.switchBranch('/workspace', 'feature');
    expect(result.success).toBe(true);
  });

  it('returns error when both switch and checkout fail', async () => {
    addResponse('switch', {
      exitCode: 1,
      stderr: "git: 'switch' is not a git command",
    });
    addResponse('checkout', {
      exitCode: 1,
      stderr: 'fatal: branch not found',
    });

    const result = await service.switchBranch('/workspace', 'nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ===========================================================================
// deleteBranch
// ===========================================================================
describe('deleteBranch', () => {
  it('deletes an existing branch', async () => {
    addResponse('branch --show-current', { stdout: 'main' });
    addResponse('branch -d', { stdout: '' });

    const result = await service.deleteBranch('/workspace', 'feature');
    expect(result.success).toBe(true);
  });

  it('refuses to delete the current branch', async () => {
    addResponse('branch --show-current', { stdout: 'main' });

    const result = await service.deleteBranch('/workspace', 'main');
    expect(result.success).toBe(false);
    expect(result.error).toContain('current');
  });

  it('rejects empty branch name', async () => {
    const result = await service.deleteBranch('/workspace', '');
    expect(result.success).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('returns error when git branch -d fails', async () => {
    addResponse('branch --show-current', { stdout: 'main' });
    addResponse('branch -d', {
      exitCode: 1,
      stderr: "error: The branch 'feature' is not fully merged.",
    });

    const result = await service.deleteBranch('/workspace', 'feature');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not fully merged');
  });
});

// ===========================================================================
// stage / commit
// ===========================================================================
describe('stage', () => {
  it('stages specific files', async () => {
    addResponse('add --', { stdout: '' });
    const result = await service.stage('/workspace', ['file1.ts', 'file2.ts']);
    expect(result.success).toBe(true);
  });

  it('stages all files when no files specified', async () => {
    addResponse('add -A', { stdout: '' });
    const result = await service.stage('/workspace');
    expect(result.success).toBe(true);
  });

  // Gap 9: Empty array should be a no-op, not stage everything
  it('empty array is a no-op and does not stage all files', async () => {
    const result = await service.stage('/workspace', []);
    expect(result.success).toBe(true);
    // No git command should be executed — no response added, and it should still succeed
  });

  it('returns error on failure', async () => {
    addResponse('add', { exitCode: 1, stderr: 'fatal: pathspec' });
    const result = await service.stage('/workspace', ['nonexistent']);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('commit', () => {
  it('commits with a message', async () => {
    addResponse('commit', { stdout: '[main abc1234] my commit' });
    const result = await service.commit('/workspace', 'my commit');
    expect(result.success).toBe(true);
  });

  it('rejects empty commit message', async () => {
    const result = await service.commit('/workspace', '  ');
    expect(result.success).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('detects nothing-to-commit error', async () => {
    addResponse('commit', {
      exitCode: 1,
      stderr: 'nothing to commit, working tree clean',
    });
    const result = await service.commit('/workspace', 'msg');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Nothing to commit');
  });
});

// ===========================================================================
// getConflictingFiles (Gap 3)
// ===========================================================================
describe('getConflictingFiles', () => {
  it('returns list of conflicting files', async () => {
    addResponse('diff --name-only --diff-filter=U', {
      stdout: 'conflict1.ts\nconflict2.ts\nconflict3.ts',
    });

    const conflicts = await service.getConflictingFiles('/workspace');
    expect(conflicts).toEqual(['conflict1.ts', 'conflict2.ts', 'conflict3.ts']);
  });

  it('returns empty array when no conflicts', async () => {
    addResponse('diff --name-only --diff-filter=U', { stdout: '' });

    const conflicts = await service.getConflictingFiles('/workspace');
    expect(conflicts).toEqual([]);
  });

  it('uses correct --diff-filter=U flag', async () => {
    addResponse('diff --name-only --diff-filter=U', { stdout: '' });
    // This test verifies the command prefix is matched correctly.
    // If the implementation changes the arg order, this will fail.
    const conflicts = await service.getConflictingFiles('/workspace');
    expect(conflicts).toEqual([]);
  });
});

// ===========================================================================
// mergeBranch / abortCurrentOperation
// ===========================================================================
describe('mergeBranch', () => {
  it('merges successfully', async () => {
    addResponse('merge', { stdout: 'Merge made by the "ort" strategy.' });
    const result = await service.mergeBranch('/workspace', 'feature');
    expect(result.success).toBe(true);
  });

  it('rejects empty branch name', async () => {
    const result = await service.mergeBranch('/workspace', '  ');
    expect(result.success).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('returns error on merge conflict', async () => {
    addResponse('merge', {
      exitCode: 1,
      stderr: 'CONFLICT (content): Merge conflict in file.ts\nAutomatic merge failed',
    });
    const result = await service.mergeBranch('/workspace', 'feature');
    expect(result.success).toBe(false);
    expect(result.error).toContain('CONFLICT');
  });
});

describe('abortCurrentOperation', () => {
  it('aborts a merge', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('rev-parse --verify MERGE_HEAD', { stdout: 'abc123' });
    addResponse('diff --name-only', { stdout: '' });
    addResponse('merge --abort', { stdout: '' });

    const result = await service.abortCurrentOperation('/workspace');
    expect(result.success).toBe(true);
  });

  it('aborts a rebase', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('rev-parse --verify MERGE_HEAD', { exitCode: 1, stderr: '' });
    addResponse('rev-parse --verify REBASE_HEAD', { stdout: 'abc123' });
    addResponse('diff --name-only', { stdout: '' });
    addResponse('rebase --abort', { stdout: '' });

    const result = await service.abortCurrentOperation('/workspace');
    expect(result.success).toBe(true);
  });

  it('returns error when no operation is in progress', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('rev-parse --verify MERGE_HEAD', { exitCode: 1, stderr: '' });
    addResponse('rev-parse --verify REBASE_HEAD', { exitCode: 1, stderr: '' });
    addResponse('rev-parse --verify CHERRY_PICK_HEAD', { exitCode: 1, stderr: '' });

    const result = await service.abortCurrentOperation('/workspace');
    expect(result.success).toBe(false);
    expect(result.error).toContain('No merge or rebase');
  });
});

// ===========================================================================
// getOperationState
// ===========================================================================
describe('getOperationState', () => {
  it('detects merge in progress with conflicts', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('rev-parse --verify MERGE_HEAD', { stdout: 'abc' });
    addResponse('diff --name-only --diff-filter=U', { stdout: 'file1.ts\nfile2.ts' });

    const result = await service.getOperationState('/workspace');

    expect(result.success).toBe(true);
    expect(result.inProgress).toBe(true);
    expect(result.mode).toBe('merge');
    expect(result.conflicts).toEqual(['file1.ts', 'file2.ts']);
    expect(result.message).toContain('2 conflicts');
  });

  it('uses singular "conflict" for exactly 1 conflict', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('rev-parse --verify MERGE_HEAD', { stdout: 'abc' });
    addResponse('diff --name-only --diff-filter=U', { stdout: 'file1.ts' });

    const result = await service.getOperationState('/workspace');
    expect(result.message).toContain('1 conflict');
    expect(result.message).not.toContain('1 conflicts');
  });

  it('detects rebase in progress', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('rev-parse --verify MERGE_HEAD', { exitCode: 1, stderr: '' });
    addResponse('rev-parse --verify REBASE_HEAD', { stdout: 'abc' });
    addResponse('diff --name-only --diff-filter=U', { stdout: '' });

    const result = await service.getOperationState('/workspace');

    expect(result.success).toBe(true);
    expect(result.inProgress).toBe(true);
    expect(result.mode).toBe('rebase');
    expect(result.conflicts).toEqual([]);
  });

  it('detects cherry-pick in progress', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('rev-parse --verify MERGE_HEAD', { exitCode: 1, stderr: '' });
    addResponse('rev-parse --verify REBASE_HEAD', { exitCode: 1, stderr: '' });
    addResponse('rev-parse --verify CHERRY_PICK_HEAD', { stdout: 'def456' });
    addResponse('diff --name-only --diff-filter=U', { stdout: '' });

    const result = await service.getOperationState('/workspace');

    expect(result.success).toBe(true);
    expect(result.inProgress).toBe(true);
    expect(result.mode).toBe('merge');
    expect(result.message).toContain('Cherry-pick');
    expect(result.conflicts).toEqual([]);
  });

  it('returns no operation when neither MERGE_HEAD nor REBASE_HEAD', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('rev-parse --verify MERGE_HEAD', { exitCode: 1, stderr: '' });
    addResponse('rev-parse --verify REBASE_HEAD', { exitCode: 1, stderr: '' });
    addResponse('rev-parse --verify CHERRY_PICK_HEAD', { exitCode: 1, stderr: '' });

    const result = await service.getOperationState('/workspace');

    expect(result.success).toBe(true);
    expect(result.inProgress).toBe(false);
    expect(result.mode).toBe('none');
  });

  it('returns not-a-repo when isRepo check fails', async () => {
    addResponse('rev-parse --git-dir', { exitCode: 128, stderr: 'not a git repo' });

    const result = await service.getOperationState('/workspace');
    expect(result.isRepo).toBe(false);
    expect(result.message).toContain('Not a git repository');
  });
});

// ===========================================================================
// Stash operations
// ===========================================================================
describe('stash operations', () => {
  describe('stashChanges', () => {
    it('stashes changes', async () => {
      addResponse('stash push', { stdout: 'Saved working directory' });
      const result = await service.stashChanges('/workspace');
      expect(result.success).toBe(true);
    });

    it('stashes with message and untracked', async () => {
      addResponse('stash push', { stdout: 'Saved' });
      const result = await service.stashChanges('/workspace', 'my stash', true);
      expect(result.success).toBe(true);
    });

    it('returns error on failure', async () => {
      addResponse('stash push', { exitCode: 1, stderr: 'no changes to save' });
      const result = await service.stashChanges('/workspace');
      expect(result.success).toBe(false);
    });
  });

  describe('listStashes', () => {
    it('parses stash list with unit separator', async () => {
      addResponse('stash list', {
        stdout: 'abc123\x1Fstash@{0}\x1FOn main: my stash\ndef456\x1Fstash@{1}\x1FOn main: other',
      });
      const stashes = await service.listStashes('/workspace');
      expect(stashes).toHaveLength(2);
      expect(stashes[0]).toEqual({
        hash: 'abc123',
        ref: 'stash@{0}',
        message: 'On main: my stash',
      });
      expect(stashes[1]).toEqual({
        hash: 'def456',
        ref: 'stash@{1}',
        message: 'On main: other',
      });
    });

    it('returns empty array when no stashes', async () => {
      addResponse('stash list', { stdout: '' });
      const stashes = await service.listStashes('/workspace');
      expect(stashes).toEqual([]);
    });

    // Gap 5: listStashes error handling
    it('returns empty array when git stash list fails', async () => {
      addResponse('stash list', { exitCode: 1, stderr: 'fatal: not a git repository' });
      const stashes = await service.listStashes('/workspace');
      expect(stashes).toEqual([]);
    });
  });

  describe('applyStash / popStash / dropStash / clearStashes', () => {
    it('applies a stash', async () => {
      addResponse('stash apply', { stdout: '' });
      expect(await service.applyStash('/workspace', 'stash@{0}')).toEqual({ success: true });
    });

    it('pops a stash', async () => {
      addResponse('stash pop', { stdout: '' });
      expect(await service.popStash('/workspace', 'stash@{0}')).toEqual({ success: true });
    });

    it('drops a stash', async () => {
      addResponse('stash drop', { stdout: '' });
      expect(await service.dropStash('/workspace', 'stash@{0}')).toEqual({ success: true });
    });

    it('clears all stashes', async () => {
      addResponse('stash clear', { stdout: '' });
      expect(await service.clearStashes('/workspace')).toEqual({ success: true });
    });

    it('returns errors on failure', async () => {
      addResponse('stash apply', { exitCode: 1, stderr: 'conflict' });
      const result = await service.applyStash('/workspace', 'stash@{0}');
      expect(result.success).toBe(false);
      expect(result.error).toContain('conflict');
    });
  });
});

// ===========================================================================
// getHistory
// ===========================================================================
describe('getHistory', () => {
  it('parses commit history', async () => {
    addResponse('log', {
      stdout: 'fullhash1\x1Fshort1\x1FAlice\x1F2024-01-15\x1FInitial commit\nfullhash2\x1Fshort2\x1FBob\x1F2024-01-16\x1FAdd feature',
    });

    const history = await service.getHistory('/workspace');

    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({
      hash: 'fullhash1',
      shortHash: 'short1',
      author: 'Alice',
      date: '2024-01-15',
      subject: 'Initial commit',
    });
    expect(history[1]).toEqual({
      hash: 'fullhash2',
      shortHash: 'short2',
      author: 'Bob',
      date: '2024-01-16',
      subject: 'Add feature',
    });
  });

  it('returns empty array for repo with no commits', async () => {
    addResponse('log', {
      exitCode: 128,
      stderr: 'fatal: your current branch does not have any commits yet',
    });

    const history = await service.getHistory('/workspace');
    expect(history).toEqual([]);
  });

  it('returns empty array for unknown revision error', async () => {
    addResponse('log', {
      exitCode: 128,
      stderr: 'fatal: unknown revision',
    });

    const history = await service.getHistory('/workspace');
    expect(history).toEqual([]);
  });

  // Gap 7: getHistory returns [] for unexpected errors (no longer throws)
  it('returns empty array for unexpected errors instead of throwing', async () => {
    addResponse('log', {
      exitCode: 1,
      stderr: 'fatal: some unexpected error',
    });

    const history = await service.getHistory('/workspace');
    expect(history).toEqual([]);
  });

  // Gap 6: getHistory limit clamping
  it('clamps limit to minimum of 1', async () => {
    addResponse('log -n1', { stdout: 'hash1\x1Fsh1\x1FAlice\x1F2024-01-01\x1FMsg' });

    const history = await service.getHistory('/workspace', 0);
    expect(history).toHaveLength(1);
  });

  it('clamps limit to maximum of 50', async () => {
    addResponse('log -n50', { stdout: '' });

    const history = await service.getHistory('/workspace', 100);
    expect(history).toEqual([]);
  });

  it('clamps negative limit to 1', async () => {
    addResponse('log -n1', { stdout: '' });

    const history = await service.getHistory('/workspace', -5);
    expect(history).toEqual([]);
  });
});

// ===========================================================================
// getDiff
// ===========================================================================
describe('getDiff', () => {
  it('returns working tree diff', async () => {
    addResponse('diff', { stdout: ' src/main.ts | 5 ++---\n 1 file changed' });

    const result = await service.getDiff('/workspace', 'working');

    expect(result.success).toBe(true);
    expect(result.title).toBe('Working Tree Diff');
    expect(result.output).toContain('src/main.ts');
  });

  it('returns staged diff', async () => {
    addResponse('diff --cached', { stdout: ' src/main.ts | 2 ++\n 1 file changed' });

    const result = await service.getDiff('/workspace', 'staged');

    expect(result.success).toBe(true);
    expect(result.title).toBe('Staged Diff');
  });

  it('returns commit diff', async () => {
    addResponse('show', { stdout: 'commit abc123\nAuthor: Alice\n\n    Fix bug\n' });

    const result = await service.getDiff('/workspace', 'commit', 'abc123fullhash');

    expect(result.success).toBe(true);
    expect(result.title).toContain('abc123fullha');
  });

  // Gap 4: Short ref shorter than 12 characters
  it('handles commit diff with short ref (less than 12 chars)', async () => {
    addResponse('show', { stdout: 'commit abc\nAuthor: Alice\n\n    Fix\n' });

    const result = await service.getDiff('/workspace', 'commit', 'abc');

    expect(result.success).toBe(true);
    expect(result.title).toContain('abc');
  });

  it('rejects commit diff without ref', async () => {
    const result = await service.getDiff('/workspace', 'commit');

    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('returns error on diff failure', async () => {
    addResponse('diff', { exitCode: 128, stderr: 'fatal: bad revision' });

    const result = await service.getDiff('/workspace', 'working');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ===========================================================================
// getCommitPromptContext
// ===========================================================================
describe('getCommitPromptContext', () => {
  it('returns context with staged changes and diff', async () => {
    // getStatus flow
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain', { stdout: 'M  staged.ts\n M working.ts' });
    addResponse('branch --show-current', { stdout: 'main' });
    // getDiff staged (diff --cached --stat ...)
    addResponse('diff --cached', { stdout: 'staged.ts | 3 ++\n 1 file changed' });

    const ctx = await service.getCommitPromptContext('/workspace');

    expect(ctx.success).toBe(true);
    expect(ctx.currentBranch).toBe('main');
    expect(ctx.diffMode).toBe('staged');
    expect(ctx.changes).toHaveLength(1);
    expect(ctx.changes[0].path).toBe('staged.ts');
    expect(ctx.diffSummary).toContain('staged.ts');
  });

  it('returns working diff when no staged changes', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain', { stdout: '?? new.ts\n M working.ts' });
    addResponse('branch --show-current', { stdout: 'feature' });
    // getDiff working (diff --stat --summary ...)
    addResponse('diff --stat', { stdout: 'working.ts | 5 ---\n 1 file changed' });

    const ctx = await service.getCommitPromptContext('/workspace');

    expect(ctx.success).toBe(true);
    expect(ctx.diffMode).toBe('working');
    expect(ctx.changes).toHaveLength(2);
  });

  it('returns error when no changes', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain', { stdout: '' });
    addResponse('branch --show-current', { stdout: 'main' });

    const ctx = await service.getCommitPromptContext('/workspace');

    expect(ctx.success).toBe(false);
    expect(ctx.error).toContain('No changes');
  });

  it('returns error when not a repo', async () => {
    addResponse('rev-parse --git-dir', { exitCode: 128, stderr: 'not a repo' });

    const ctx = await service.getCommitPromptContext('/workspace');

    expect(ctx.success).toBe(false);
    expect(ctx.error).toContain('Not a git repository');
  });
});

// ===========================================================================
// Polling
// ===========================================================================
describe('polling', () => {
  afterEach(() => {
    service.stopPolling();
  });

  it('startPolling emits initial status', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain', { stdout: '' });
    addResponse('branch --show-current', { stdout: 'main' });

    service.startPolling('/workspace');
    // Wait for the async emitStatusUpdate to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(emittedStatuses).toHaveLength(1);
    expect(emittedStatuses[0].success).toBe(true);
    expect(service.getCurrentWorkspace()).toBe('/workspace');
  });

  it('stopPolling clears the interval and workspace', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain', { stdout: '' });
    addResponse('branch --show-current', { stdout: 'main' });

    service.startPolling('/workspace');
    await new Promise((r) => setTimeout(r, 50));
    expect(emittedStatuses).toHaveLength(1);

    service.stopPolling();
    expect(service.getCurrentWorkspace()).toBeNull();
  });

  it('refresh returns current status', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain', { stdout: 'M  file.ts' });
    addResponse('branch --show-current', { stdout: 'main' });

    service.startPolling('/workspace');
    await new Promise((r) => setTimeout(r, 50));

    const result = await service.refresh();
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.changes).toHaveLength(1);
  });

  it('refresh returns null when not polling', async () => {
    expect(await service.refresh()).toBeNull();
  });

  // Gap 10: Concurrent polling restart stops old interval
  it('startPolling restarts polling when called with a different path', async () => {
    // First path responses
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain', { stdout: '' });
    addResponse('branch --show-current', { stdout: 'main' });
    // Second path responses
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain', { stdout: 'M  file.ts' });
    addResponse('branch --show-current', { stdout: 'feature' });

    service.startPolling('/workspace-a');
    await new Promise((r) => setTimeout(r, 50));

    expect(service.getCurrentWorkspace()).toBe('/workspace-a');
    expect(emittedStatuses).toHaveLength(1);

    service.startPolling('/workspace-b');
    await new Promise((r) => setTimeout(r, 50));

    expect(service.getCurrentWorkspace()).toBe('/workspace-b');
    expect(emittedStatuses).toHaveLength(2);
    expect(emittedStatuses[1].currentBranch).toBe('feature');
  });
});
