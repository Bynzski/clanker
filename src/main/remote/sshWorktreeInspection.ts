import * as path from 'node:path';
import { validateWorktreeChanges } from '../worktreeChanges';
import type { GitWorktreeInspectionResult } from '../../shared/types/git';
import { SshCommandExecutor, SshExecutionError } from './sshCommandExecutor';

export const WORKTREE_INSPECTION_PYTHON = String.raw`
import json, os, subprocess, sys, fcntl
from contextlib import contextmanager
workspace, target, active_raw = sys.argv[1:4]
os.environ['GIT_TERMINAL_PROMPT'] = '0'
os.environ['GIT_OPTIONAL_LOCKS'] = '0'
def git(cwd, args):
  result = subprocess.run(['git', '-C', cwd] + args, capture_output=True, timeout=20)
  if result.returncode:
    raise RuntimeError(result.stderr.decode('utf-8', 'replace').strip() or 'Remote Git command failed')
  return result.stdout
def canonical(value):
  return os.path.isabs(value) and os.path.normpath(value) == value and os.path.realpath(value) == value
def collect_changes(cwd, visited, changes):
  if cwd in visited or len(visited) >= 128:
    raise RuntimeError('Submodule inspection exceeded its repository limit or found a cycle')
  visited.add(cwd)
  records = git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none']).split(b'\0')
  index = 0
  while index < len(records):
    record = records[index]
    index += 1
    if not record:
      continue
    if len(record) < 4 or record[2:3] != b' ':
      raise RuntimeError('Invalid Git status record')
    status, relative = record[:2], os.fsdecode(record[3:])
    if os.path.isabs(relative) or '..' in relative.split('/'):
      raise RuntimeError('Git status path is outside the checkout')
    group = changes['ignored' if status == b'!!' else 'untracked' if status == b'??' else 'tracked']
    group['count'] += 1
    example = os.path.relpath(os.path.join(cwd, relative), target)
    if relative.endswith('/'):
      example += '/'
    if len(group['paths']) < 20 and len(os.fsencode(example)) <= 4096:
      group['paths'].append(example)
    if b'R' in status or b'C' in status:
      if index >= len(records) or not records[index]:
        raise RuntimeError('Invalid Git rename record')
      index += 1
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
      if os.path.isdir(submodule) and os.listdir(submodule):
        changes['untracked']['count'] += 1
      continue
    toplevel = os.fsdecode(git(submodule, ['rev-parse', '--show-toplevel']).rstrip(b'\n'))
    if toplevel != submodule:
      raise RuntimeError('Initialized submodule repository identity changed')
    collect_changes(submodule, visited, changes)
def inspect():
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
  changes = {key: {'count': 0, 'paths': []} for key in ('tracked', 'untracked', 'ignored')}
  collect_changes(target, set(), changes)
  changed = any(group['count'] for group in changes.values())
  # Git -C resolves paths on each invocation. Detect replacement during status
  # so a changed/symlinked target is not reported ready.
  if not canonical(target):
    raise RuntimeError('Worktree directory is no longer canonical')
  return {'success': True, 'worktree': match, 'hasChanges': changed, 'changes': changes}

@contextmanager
def repository_lock(exclusive=False):
  common = os.fsdecode(git(workspace, ['rev-parse', '--path-format=absolute', '--git-common-dir']).rstrip(b'\n'))
  if not canonical(common):
    raise RuntimeError('Repository metadata directory is no longer canonical')
  descriptor = os.open(common, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
  try:
    fcntl.flock(descriptor, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
    yield
  finally:
    os.close(descriptor)
`;

const INSPECT_SCRIPT = WORKTREE_INSPECTION_PYTHON + String.raw`
try:
  with repository_lock():
    print(json.dumps(inspect()))
except Exception as error:
  sys.exit(str(error))
`;

export function validRemoteWorktreePath(value: unknown): value is string {
  return typeof value === 'string' && path.posix.isAbsolute(value) && path.posix.normalize(value) === value &&
    !value.includes('\0') && Buffer.byteLength(value) <= 4096;
}

export async function inspectSshWorktree(executor: SshCommandExecutor, target: string, workspacePath: string, worktreePath: string, activePaths: string[]): Promise<GitWorktreeInspectionResult> {
  if (!validRemoteWorktreePath(workspacePath) || !validRemoteWorktreePath(worktreePath) || !Array.isArray(activePaths) ||
      activePaths.length > 1024 || !activePaths.every(validRemoteWorktreePath)) {
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
    const changes = 'changes' in result ? validateWorktreeChanges(result.changes, result.hasChanges) : undefined;
    return { success: true, hasChanges: result.hasChanges, changes, worktree: { path: worktreePath, branch: worktree.branch, isMain: false, isLocked: false, isPrunable: false } };
  } catch (error) {
    return { success: false, error: error instanceof SshExecutionError ? error.stderr.trim() || error.message : error instanceof Error ? error.message : 'Could not inspect remote worktree' };
  }
}
