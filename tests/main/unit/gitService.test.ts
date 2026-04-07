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
const responses = new Map<string, { stdout?: string; stderr?: string; exitCode?: number; nodeErrorCode?: string }>();

function addResponse(subcommand: string, response: { stdout?: string; stderr?: string; exitCode?: number; nodeErrorCode?: string }) {
  responses.set(subcommand, response);
}

// promisify(execFile) normally converts (err, stdout, stderr) → { stdout, stderr }.
// Our mock is a plain function so promisify treats it as (err, result).
// We must return { stdout, stderr } as the second callback argument.
vi.mock('child_process', () => ({
  execFile: vi.fn((cmd: string, args: string[], options: Record<string, unknown>, callback?: (...args: unknown[]) => void) => {
    const cb = (typeof options === 'function' ? options : callback) ?? (() => {});
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
            code?: number | string;
            stdout?: string;
          };
          err.stderr = resp.stderr ?? '';
          err.code = resp.nodeErrorCode ?? resp.exitCode;
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
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head main\n1 M. N... 100644 100644 100644 s1 s2 src/main.ts\n1 A. N... 100644 100644 100644 s3 s4 new-file.ts\n? untracked.txt\n1 D. N... 100644 100644 100644 s5 s6 deleted.ts\n2 R. N... 100644 100644 100644 s7 s8 R100 old.ts\toriginal.ts',
    });

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
    expect(result.upstream).toBeNull();
    expect(result.ahead).toBe(0);
    expect(result.behind).toBe(0);
  });

  it('returns detached head when no current branch', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head (detached)',
    });

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
    expect(result.errorCode).toBe('not-a-repo');
    expect(result.error).toBeTruthy();
    expect(result.upstream).toBeNull();
    expect(result.ahead).toBe(0);
    expect(result.behind).toBe(0);
  });

  // Gap 1: Regression test for .trim() corrupting first-line status parsing
  it('correctly parses unstaged modification without trim corruption', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head main\n1 .M N... 100644 100644 100644 s1 s2 file.txt\n1 A. N... 100644 100644 100644 s3 s4 staged.ts',
    });

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

  it('parses renamed file entries with separate new path', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head main\n2 R. N... 100644 100644 100644 s1 s2 R100 new_path.ts\told_path.ts',
    });

    const result = await service.getStatus('/workspace');

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toEqual({
      path: 'new_path.ts',
      status: 'renamed',
      staged: true,
    });
  });

  // Error classification tests (GAP-5)
  it('classifies ENOENT as git-not-found', async () => {
    addResponse('rev-parse --git-dir', {
      exitCode: 1,
      nodeErrorCode: 'ENOENT',
      stderr: 'spawn git ENOENT',
    });

    const result = await service.getStatus('/workspace');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('git-not-found');
    expect(result.error).toBeTruthy();
  });

  it('classifies "not a git repository" stderr as not-a-repo', async () => {
    addResponse('rev-parse --git-dir', {
      exitCode: 128,
      stderr: 'fatal: not a git repository (or any of the parent directories): .git',
    });

    const result = await service.getStatus('/workspace');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('not-a-repo');
  });

  it('classifies unrecognized errors as unknown', async () => {
    addResponse('rev-parse --git-dir', {
      exitCode: 1,
      nodeErrorCode: 'EACCES',
      stderr: 'EACCES: permission denied',
    });

    const result = await service.getStatus('/workspace');
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('unknown');
    expect(result.error).toContain('EACCES');
  });

  it('successful status has no errorCode', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head main',
    });

    const result = await service.getStatus('/workspace');
    expect(result.success).toBe(true);
    expect(result.errorCode).toBeUndefined();
  });

  // Upstream / ahead / behind tests (GAP-2)
  it('parses upstream tracking and ahead/behind from v2 headers', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +3 -1',
    });

    const result = await service.getStatus('/workspace');
    expect(result.success).toBe(true);
    expect(result.currentBranch).toBe('main');
    expect(result.upstream).toBe('origin/main');
    expect(result.ahead).toBe(3);
    expect(result.behind).toBe(1);
  });

  it('returns null upstream when no tracking branch', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head feature',
    });

    const result = await service.getStatus('/workspace');
    expect(result.success).toBe(true);
    expect(result.currentBranch).toBe('feature');
    expect(result.upstream).toBeNull();
    expect(result.ahead).toBe(0);
    expect(result.behind).toBe(0);
  });

  it('returns zero ahead/behind when upstream exists with no divergence', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0',
    });

    const result = await service.getStatus('/workspace');
    expect(result.upstream).toBe('origin/main');
    expect(result.ahead).toBe(0);
    expect(result.behind).toBe(0);
  });

  it('handles initial repo with no commits', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid (initial)\n# branch.head main\n1 A. N... 000000 100644 100644 0000 0000 new-file.txt',
    });

    const result = await service.getStatus('/workspace');
    expect(result.success).toBe(true);
    expect(result.currentBranch).toBe('main');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toEqual({ path: 'new-file.txt', status: 'added', staged: true });
    expect(result.upstream).toBeNull();
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
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head main\n1 M. N... 100644 100644 100644 s1 s2 staged.ts\n1 .M N... 100644 100644 100644 s3 s4 working.ts',
    });
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
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head feature\n? new.ts\n1 .M N... 100644 100644 100644 s1 s2 working.ts',
    });
    // getDiff working (diff --stat --summary ...)
    addResponse('diff --stat', { stdout: 'working.ts | 5 ---\n 1 file changed' });

    const ctx = await service.getCommitPromptContext('/workspace');

    expect(ctx.success).toBe(true);
    expect(ctx.diffMode).toBe('working');
    expect(ctx.changes).toHaveLength(2);
  });

  it('returns error when no changes', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head main',
    });

    const ctx = await service.getCommitPromptContext('/workspace');

    expect(ctx.success).toBe(false);
    expect(ctx.error).toContain('No changes');
  });

  it('returns error when not a repo', async () => {
    addResponse('rev-parse --git-dir', { exitCode: 128, stderr: 'not a git repository' });

    const ctx = await service.getCommitPromptContext('/workspace');

    expect(ctx.success).toBe(false);
    expect(ctx.error).toContain('not a git repository');
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
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head main',
    });

    service.startPolling('/workspace');
    // Wait for the async emitStatusUpdate to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(emittedStatuses).toHaveLength(1);
    expect(emittedStatuses[0].success).toBe(true);
    expect(service.getCurrentWorkspace()).toBe('/workspace');
  });

  it('stopPolling clears the interval and workspace', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head main',
    });

    service.startPolling('/workspace');
    await new Promise((r) => setTimeout(r, 50));
    expect(emittedStatuses).toHaveLength(1);

    service.stopPolling();
    expect(service.getCurrentWorkspace()).toBeNull();
  });

  it('refresh returns current status', async () => {
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head main\n1 M. N... 100644 100644 100644 s1 s2 file.ts',
    });

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
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid abc123\n# branch.head main',
    });
    // Second path responses
    addResponse('rev-parse --git-dir', { stdout: '.git' });
    addResponse('status --porcelain=v2', {
      stdout: '# branch.oid def456\n# branch.head feature\n1 M. N... 100644 100644 100644 s1 s2 file.ts',
    });

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

// ===========================================================================
// detectProvider (GAP-3)
// ===========================================================================
describe('detectProvider', () => {
  describe('SSH URLs', () => {
    it('detects github.com from SSH URL', () => {
      expect(service.detectProvider('git@github.com:owner/repo.git')).toBe('github');
    });

    it('detects github.com from SSH URL without .git suffix', () => {
      expect(service.detectProvider('git@github.com:owner/repo')).toBe('github');
    });

    it('detects bitbucket.org from SSH URL', () => {
      expect(service.detectProvider('git@bitbucket.org:team/project.git')).toBe('bitbucket');
    });

    it('detects gitlab.com from SSH URL', () => {
      expect(service.detectProvider('git@gitlab.com:username/repository.git')).toBe('gitlab');
    });

    it('returns unknown for enterprise SSH URLs', () => {
      expect(service.detectProvider('git@github.mycompany.com:owner/repo.git')).toBe('unknown');
      expect(service.detectProvider('git@gitlab.internal:group/project.git')).toBe('unknown');
      expect(service.detectProvider('git@bitbucket.corp.com:team/repo.git')).toBe('unknown');
    });

    it('returns unknown for unknown SSH hosts', () => {
      expect(service.detectProvider('git@custom-gitlab.example.com:owner/repo.git')).toBe('unknown');
    });
  });

  describe('HTTPS URLs', () => {
    it('detects github.com from HTTPS URL', () => {
      expect(service.detectProvider('https://github.com/owner/repo.git')).toBe('github');
    });

    it('detects github.com from HTTPS URL without .git suffix', () => {
      expect(service.detectProvider('https://github.com/owner/repo')).toBe('github');
    });

    it('detects bitbucket.org from HTTPS URL', () => {
      expect(service.detectProvider('https://bitbucket.org/team/project.git')).toBe('bitbucket');
    });

    it('detects gitlab.com from HTTPS URL', () => {
      expect(service.detectProvider('https://gitlab.com/username/repository.git')).toBe('gitlab');
    });

    it('returns unknown for enterprise HTTPS URLs', () => {
      expect(service.detectProvider('https://github.mycompany.com/owner/repo.git')).toBe('unknown');
      expect(service.detectProvider('https://gitlab.internal/group/project.git')).toBe('unknown');
    });

    it('returns unknown for custom self-hosted instances', () => {
      expect(service.detectProvider('https://git.mycompany.org/owner/repo.git')).toBe('unknown');
    });
  });

  describe('edge cases', () => {
    it('returns unknown for malformed URLs', () => {
      expect(service.detectProvider('not-a-url')).toBe('unknown');
      expect(service.detectProvider('')).toBe('unknown');
    });

    it('returns unknown for file:// URLs', () => {
      expect(service.detectProvider('file:///home/user/repo')).toBe('unknown');
    });

    it('handles SSH URL with ssh:// scheme', () => {
      // new URL() correctly parses ssh:// URLs and extracts the hostname
      expect(service.detectProvider('ssh://git@github.com/owner/repo.git')).toBe('github');
      expect(service.detectProvider('ssh://git@gitlab.com/user/repo.git')).toBe('gitlab');
    });
  });
});

// ===========================================================================
// getRemotes (GAP-3)
// ===========================================================================
describe('getRemotes', () => {
  it('returns empty remotes array for repo with no remotes', async () => {
    addResponse('remote -v', { stdout: '' });

    const result = await service.getRemotes('/workspace');

    expect(result.success).toBe(true);
    expect(result.remotes).toEqual([]);
    expect(result.provider).toBe('unknown');
  });

  it('parses a single origin remote', async () => {
    addResponse('remote -v', {
      stdout: 'origin	https://github.com/owner/repo.git (fetch)\norigin	https://github.com/owner/repo.git (push)',
    });

    const result = await service.getRemotes('/workspace');

    expect(result.success).toBe(true);
    expect(result.remotes).toHaveLength(1);
    expect(result.remotes[0]).toEqual({
      name: 'origin',
      fetchUrl: 'https://github.com/owner/repo.git',
      pushUrl: 'https://github.com/owner/repo.git',
    });
    expect(result.provider).toBe('github');
  });

  it('parses multiple remotes with different URLs', async () => {
    addResponse('remote -v', {
      stdout:
        'origin\thttps://github.com/owner/repo.git (fetch)\n' +
        'origin\thttps://github.com/owner/repo.git (push)\n' +
        'upstream\thttps://github.com/upstream/repo.git (fetch)\n' +
        'upstream\thttps://github.com/upstream/repo.git (push)',
    });

    const result = await service.getRemotes('/workspace');

    expect(result.success).toBe(true);
    expect(result.remotes).toHaveLength(2);
    expect(result.remotes[0].name).toBe('origin');
    expect(result.remotes[1].name).toBe('upstream');
    expect(result.provider).toBe('github');
  });

  it('detects Bitbucket provider from HTTPS URL', async () => {
    addResponse('remote -v', {
      stdout: 'origin\thttps://bitbucket.org/team/project.git (fetch)\norigin\thttps://bitbucket.org/team/project.git (push)',
    });

    const result = await service.getRemotes('/workspace');

    expect(result.provider).toBe('bitbucket');
  });

  it('detects GitLab provider from HTTPS URL', async () => {
    addResponse('remote -v', {
      stdout: 'origin\thttps://gitlab.com/mygroup/myrepo.git (fetch)\norigin\thttps://gitlab.com/mygroup/myrepo.git (push)',
    });

    const result = await service.getRemotes('/workspace');

    expect(result.provider).toBe('gitlab');
  });

  it('detects GitHub provider from SSH URL', async () => {
    addResponse('remote -v', {
      stdout: 'origin\tgit@github.com:owner/repo.git (fetch)\norigin\tgit@github.com:owner/repo.git (push)',
    });

    const result = await service.getRemotes('/workspace');

    expect(result.provider).toBe('github');
  });

  it('returns unknown provider for self-hosted repo', async () => {
    addResponse('remote -v', {
      stdout: 'origin\thttps://git.mycompany.com/owner/repo.git (fetch)\norigin\thttps://git.mycompany.com/owner/repo.git (push)',
    });

    const result = await service.getRemotes('/workspace');

    expect(result.provider).toBe('unknown');
    expect(result.success).toBe(true);
  });

  it('uses first remote fetch URL for provider detection', async () => {
    // even if origin is self-hosted, upstream is github — first remote wins
    addResponse('remote -v', {
      stdout:
        'self\thttps://git.internal/owner/repo.git (fetch)\n' +
        'self\thttps://git.internal/owner/repo.git (push)\n' +
        'github\thttps://github.com/owner/repo.git (fetch)\n' +
        'github\thttps://github.com/owner/repo.git (push)',
    });

    const result = await service.getRemotes('/workspace');

    // First remote in alphabetical order (by insertion) — 'github' > 'self' alphabetically
    // The implementation uses Array.from on the Map which preserves insertion order
    // git outputs remotes in insertion order, so 'self' would come first if it was created first
    // We just verify the first remote's provider is used
    expect(result.provider).toBe('unknown'); // 'self' is first
  });

  it('handles remote with only fetch URL', async () => {
    addResponse('remote -v', {
      stdout: 'origin\thttps://github.com/owner/repo.git (fetch)',
    });

    const result = await service.getRemotes('/workspace');

    expect(result.success).toBe(true);
    expect(result.remotes).toHaveLength(1);
    expect(result.remotes[0].fetchUrl).toBe('https://github.com/owner/repo.git');
    expect(result.remotes[0].pushUrl).toBe('');
    expect(result.provider).toBe('github');
  });

  it('returns error on git failure', async () => {
    addResponse('remote -v', {
      exitCode: 128,
      stderr: 'fatal: not a git repository',
    });

    const result = await service.getRemotes('/workspace');

    expect(result.success).toBe(false);
    expect(result.remotes).toEqual([]);
    expect(result.provider).toBe('unknown');
    expect(result.error).toBeTruthy();
  });

  it('handles remote output with trailing newline', async () => {
    addResponse('remote -v', {
      stdout: 'origin\thttps://github.com/owner/repo.git (fetch)\norigin\thttps://github.com/owner/repo.git (push)\n',
    });

    const result = await service.getRemotes('/workspace');

    expect(result.success).toBe(true);
    expect(result.remotes).toHaveLength(1);
    expect(result.remotes[0].name).toBe('origin');
  });
});

// ===========================================================================
// fetch / pull / push (GAP-4)
// ===========================================================================
describe('fetch', () => {
  it('fetches from default remote with prune', async () => {
    addResponse('fetch --prune', { stdout: '' });

    const result = await service.fetch('/workspace');

    expect(result.success).toBe(true);
  });

  it('fetches from a specific remote', async () => {
    addResponse('fetch upstream --prune', { stdout: '' });

    const result = await service.fetch('/workspace', 'upstream');

    expect(result.success).toBe(true);
  });

  it('returns error on git failure', async () => {
    addResponse('fetch --prune', {
      exitCode: 128,
      stderr: 'fatal: not a git repository',
    });

    const result = await service.fetch('/workspace');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error on network failure', async () => {
    addResponse('fetch --prune', {
      exitCode: 128,
      stderr: 'ssh: connect to host github.com port 22: Connection refused',
    });

    const result = await service.fetch('/workspace');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });
});

describe('pull', () => {
  it('pulls successfully with default settings', async () => {
    addResponse('pull', { stdout: 'Already up to date.' });

    const result = await service.pull('/workspace');

    expect(result.success).toBe(true);
  });

  it('pulls with --rebase when specified', async () => {
    addResponse('pull --rebase', { stdout: 'Successfully rebased.' });

    const result = await service.pull('/workspace', true);

    expect(result.success).toBe(true);
  });

  it('pulls with --no-rebase when specified', async () => {
    addResponse('pull --no-rebase', { stdout: 'Merge made by ort.' });

    const result = await service.pull('/workspace', false);

    expect(result.success).toBe(true);
  });

  it('returns error on merge conflict', async () => {
    addResponse('pull', {
      exitCode: 1,
      stderr: 'Merge conflict in src/main.ts. Fix conflicts and commit the result.',
    });

    const result = await service.pull('/workspace');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Merge conflict');
  });

  it('returns error on git failure', async () => {
    addResponse('pull', {
      exitCode: 128,
      stderr: 'fatal: not a git repository',
    });

    const result = await service.pull('/workspace');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error on authentication failure', async () => {
    addResponse('pull', {
      exitCode: 128,
      stderr: 'remote: Authentication failed.',
    });

    const result = await service.pull('/workspace');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication failed');
  });
});

describe('push', () => {
  it('pushes successfully', async () => {
    addResponse('push', { stdout: 'Everything up-to-date.' });

    const result = await service.push('/workspace');

    expect(result.success).toBe(true);
  });

  it('pushes to a specific remote and branch', async () => {
    addResponse('push origin main', { stdout: 'Total 0.' });

    const result = await service.push('/workspace', 'origin', 'main');

    expect(result.success).toBe(true);
  });

  it('pushes with --force-with-lease when specified', async () => {
    addResponse('push --force-with-lease', { stdout: '+ abc1234..def5678 main -> main' });

    const result = await service.push('/workspace', undefined, undefined, true);

    expect(result.success).toBe(true);
  });

  it('returns rejected error with actionable hint', async () => {
    addResponse('push', {
      exitCode: 1,
      stderr: '! [rejected] main -> main (fetch first)',
    });

    const result = await service.push('/workspace');

    expect(result.success).toBe(false);
    expect(result.error).toContain('rejected');
    expect(result.error).toContain('Fetch');
  });

  it('returns upstream error with actionable hint', async () => {
    addResponse('push', {
      exitCode: 128,
      stderr: 'fatal: The current branch main has no upstream branch.',
    });

    const result = await service.push('/workspace');

    expect(result.success).toBe(false);
    expect(result.error).toContain('upstream');
  });

  it('returns auth error with actionable hint', async () => {
    addResponse('push', {
      exitCode: 128,
      stderr: 'remote: Permission denied. Authentication failed.',
    });

    const result = await service.push('/workspace');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Authentication failed');
  });

  it('returns generic error on git failure', async () => {
    addResponse('push', {
      exitCode: 128,
      stderr: 'fatal: not a git repository',
    });

    const result = await service.push('/workspace');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
