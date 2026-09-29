import * as path from 'node:path';
import type { GitWorktreeInspectionResult } from '../../shared/types/git';
import { SshCommandExecutor, SshExecutionError } from './sshCommandExecutor';

const INSPECT_SCRIPT = String.raw`
import json, os, subprocess, sys
workspace, target, active_raw = sys.argv[1:]
os.environ['GIT_TERMINAL_PROMPT'] = '0'
os.environ['GIT_OPTIONAL_LOCKS'] = '0'
def git(cwd, args):
  result = subprocess.run(['git', '-C', cwd] + args, capture_output=True, timeout=20)
  if result.returncode:
    raise RuntimeError(result.stderr.decode('utf-8', 'replace').strip() or 'Remote Git command failed')
  return result.stdout
def canonical(value):
  return os.path.isabs(value) and os.path.normpath(value) == value and os.path.realpath(value) == value
def has_changes(cwd, visited):
  if cwd in visited or len(visited) >= 128:
    raise RuntimeError('Submodule inspection exceeded its repository limit or found a cycle')
  visited.add(cwd)
  # Override submodule.<name>.ignore and diff.ignoreSubmodules. The parent
  # still cannot report ignored files inside a submodule, so inspect gitlinks
  # from each initialized checkout's index as well (including nested ones).
  if git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored', '--ignore-submodules=none']):
    return True
  for record in git(cwd, ['ls-files', '--stage', '-z']).split(b'\0'):
    if not record:
      continue
    metadata, relative = record.split(b'\t', 1)
    if metadata.split(b' ')[0] != b'160000':
      continue
    submodule = os.path.join(cwd, os.fsdecode(relative))
    if not canonical(submodule) or os.path.commonpath([target, submodule]) != target or submodule == cwd:
      raise RuntimeError('Submodule path is outside the checkout or no longer canonical')
    if not os.path.lexists(os.path.join(submodule, '.git')):
      # Empty uninitialized submodules have no contents to preserve. Treat
      # populated directories without Git metadata conservatively as changes.
      if os.path.isdir(submodule) and os.listdir(submodule):
        return True
      continue
    toplevel = os.fsdecode(git(submodule, ['rev-parse', '--show-toplevel']).rstrip(b'\n'))
    if toplevel != submodule:
      raise RuntimeError('Initialized submodule repository identity changed')
    if has_changes(submodule, visited):
      return True
  return False
try:
  if not canonical(workspace) or not os.path.isdir(workspace):
    raise RuntimeError('Registered workspace is no longer a canonical directory')
  records = git(workspace, ['worktree', 'list', '--porcelain', '-z']).split(b'\0\0')
  match = None
  for index, record in enumerate(records):
    fields = record.split(b'\0')
    entry = next((os.fsdecode(field[9:]) for field in fields if field.startswith(b'worktree ')), None)
    if entry == target:
      if index == 0:
        raise RuntimeError('The main repository worktree cannot be removed')
      if any(field == b'locked' or field.startswith(b'locked ') for field in fields):
        raise RuntimeError('Worktree is locked')
      if any(field == b'prunable' or field.startswith(b'prunable ') for field in fields):
        raise RuntimeError('Worktree directory is missing or prunable')
      ref = next((field[7:] for field in fields if field.startswith(b'branch ')), b'')
      match = {'path': entry, 'branch': os.fsdecode(ref[11:]) if ref.startswith(b'refs/heads/') else None,
               'isMain': False, 'isLocked': False, 'isPrunable': False}
      break
  if match is None:
    raise RuntimeError('This is not a linked worktree of the registered repository')
  if not canonical(target) or not os.path.isdir(target):
    raise RuntimeError('Worktree directory is missing or no longer canonical')
  for active in json.loads(active_raw):
    active = os.path.realpath(active)
    if os.path.commonpath([target, active]) in (target, active):
      raise RuntimeError('Close workspace tabs and stop active terminals using this checkout before removal')
  # Check common-directory identity before asking Git to inspect a sibling
  # checkout; no arbitrary caller-supplied path may select another repository.
  common = git(workspace, ['rev-parse', '--path-format=absolute', '--git-common-dir']).rstrip(b'\n')
  target_common = git(target, ['rev-parse', '--path-format=absolute', '--git-common-dir']).rstrip(b'\n')
  if os.path.realpath(os.fsdecode(common)) != os.path.realpath(os.fsdecode(target_common)):
    raise RuntimeError('Worktree repository identity changed; refresh the list')
  changed = has_changes(target, set())
  # Git -C resolves paths on each invocation. Detect replacement during status
  # so a changed/symlinked target is not reported ready.
  if not canonical(target):
    raise RuntimeError('Worktree directory is no longer canonical')
  print(json.dumps({'success': True, 'worktree': match, 'hasChanges': changed}))
except Exception as error:
  sys.exit(str(error))
`;

function validPath(value: unknown): value is string {
  return typeof value === 'string' && path.posix.isAbsolute(value) && path.posix.normalize(value) === value &&
    !value.includes('\0') && Buffer.byteLength(value) <= 4096;
}

export async function inspectSshWorktree(executor: SshCommandExecutor, target: string, workspacePath: string, worktreePath: string, activePaths: string[]): Promise<GitWorktreeInspectionResult> {
  if (!validPath(workspacePath) || !validPath(worktreePath) || !Array.isArray(activePaths) ||
      activePaths.length > 1024 || !activePaths.every(validPath)) {
    return { success: false, error: 'Invalid remote worktree inspection paths' };
  }
  try {
    const { stdout } = await executor.exec(target, 'python3', ['-c', INSPECT_SCRIPT, workspacePath, worktreePath, JSON.stringify(activePaths)], { timeoutMs: 90000, maxBuffer: 128 * 1024 });
    const result: unknown = JSON.parse(stdout);
    if (!result || typeof result !== 'object' || !('success' in result) || result.success !== true ||
        !('hasChanges' in result) || typeof result.hasChanges !== 'boolean' || !('worktree' in result) ||
        !result.worktree || typeof result.worktree !== 'object') throw new Error('Invalid remote worktree inspection response');
    const worktree = result.worktree;
    if (!('path' in worktree) || worktree.path !== worktreePath || !('branch' in worktree) ||
        (worktree.branch !== null && typeof worktree.branch !== 'string') ||
        !('isMain' in worktree) || worktree.isMain !== false || !('isLocked' in worktree) || worktree.isLocked !== false ||
        !('isPrunable' in worktree) || worktree.isPrunable !== false) throw new Error('Invalid remote worktree inspection response');
    return { success: true, hasChanges: result.hasChanges, worktree: { path: worktreePath, branch: worktree.branch, isMain: false, isLocked: false, isPrunable: false } };
  } catch (error) {
    return { success: false, error: error instanceof SshExecutionError ? error.stderr.trim() || error.message : error instanceof Error ? error.message : 'Could not inspect remote worktree' };
  }
}
