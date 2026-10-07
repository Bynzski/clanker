import * as path from 'node:path';
import type { GitWorktreeRemoveResult, GitWorktreeRemovalOptions } from '../../shared/types/git';
import { WORKTREE_INSPECTION_PYTHON, validRemoteWorktreePath } from './sshWorktreeInspection';
import { SshCommandExecutor } from './sshCommandExecutor';

export function remoteRemovalPaths(worktreePath: string, operationId: string) {
  const parent = path.posix.dirname(worktreePath);
  return {
    stagingPath: path.posix.join(parent, `.clanker-removing-${operationId}`),
    recoveryDirectory: path.posix.join(parent, '.clanker-worktree-recovery', `removed-${operationId}`),
  };
}

const PRIVATE_DIRECTORY_PYTHON = String.raw`
import stat
def private_directory(directory, label):
  info = os.lstat(directory)
  if not canonical(directory) or not stat.S_ISDIR(info.st_mode):
    raise RuntimeError(label + ' is not a canonical regular directory')
  if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
    raise RuntimeError(label + ' must be owned by the SSH account with private permissions (0700)')
`;

const REMOVE_SCRIPT = WORKTREE_INSPECTION_PYTHON + PRIVATE_DIRECTORY_PYTHON + String.raw`
expected, operation = json.loads(sys.argv[4]), sys.argv[5]
discard_ignored = len(sys.argv) > 6 and sys.argv[6] == 'true'
stage, bundle, archive, journal = None, None, None, None
try:
  common = os.fsdecode(git(workspace, ['rev-parse', '--path-format=absolute', '--git-common-dir']).rstrip(b'\n'))
  if not canonical(common):
    raise RuntimeError('Repository metadata directory is no longer canonical')
  journal_directory = os.path.join(common, 'clanker-worktree-operations')
  try:
    os.mkdir(journal_directory, 0o700)
  except FileExistsError:
    pass
  private_directory(journal_directory, 'Operation journal')
  journal_path = os.path.join(journal_directory, operation + '.json')
  with open(journal_path, 'x') as record:
    json.dump({'state': 'started'}, record)
    record.flush()
    os.fsync(record.fileno())
  journal = journal_path
  with repository_lock(True):
    inspection = inspect()
    if inspection['worktree']['branch'] != expected:
      raise RuntimeError('Worktree branch changed; inspect it again')
    changes = inspection['changes']
    ignored_only = changes['ignored']['count'] > 0 and changes['tracked']['count'] == 0 and changes['untracked']['count'] == 0
    if inspection['hasChanges'] and not (discard_ignored and ignored_only):
      raise RuntimeError('Worktree has uncommitted, untracked, or ignored files')
    if any(record.startswith(b'160000 ') for record in git(target, ['ls-files', '--stage', '-z']).split(b'\0')):
      raise RuntimeError('Remote removal of worktrees containing submodules is not supported')
    parent = os.path.dirname(target)
    recovery = os.path.join(parent, '.clanker-worktree-recovery')
    try:
      os.mkdir(recovery, 0o700)
    except FileExistsError:
      pass
    private_directory(recovery, 'Recovery folder')
    bundle = os.path.join(recovery, 'removed-' + operation)
    stage = os.path.join(parent, '.clanker-removing-' + operation)
    archive = os.path.join(bundle, 'checkout')
    if os.path.lexists(stage):
      raise RuntimeError('Removal staging path already exists')
    os.mkdir(bundle, 0o700)
    private_directory(bundle, 'Recovery destination')
    with open(os.path.join(bundle, 'recovery.json'), 'x') as metadata:
      json.dump({'originalPath': target, 'branch': expected, 'sourceWorkspace': workspace}, metadata)
      metadata.flush()
      os.fsync(metadata.fileno())
    original = os.stat(target, follow_symlinks=False)
    git(workspace, ['worktree', 'move', target, stage])
    moved = os.stat(stage, follow_symlinks=False)
    if not canonical(stage) or (original.st_dev, original.st_ino) != (moved.st_dev, moved.st_ino):
      raise RuntimeError('Worktree directory changed during removal')
    if not canonical(bundle) or os.path.lexists(archive):
      raise RuntimeError('Recovery destination changed during removal')
    # Same-parent rename preserves the checkout, including files written after
    # inspection. Only the now-missing staging registration is removed by Git.
    os.rename(stage, archive)
    if os.path.lexists(stage):
      raise RuntimeError('Removal staging path was recreated; its new contents were left in place')
    git(workspace, ['worktree', 'remove', stage])
    remaining = git(workspace, ['worktree', 'list', '--porcelain', '-z'])
    if b'worktree ' + os.fsencode(stage) + b'\0' in remaining:
      raise RuntimeError('Git still lists the removal staging path')
    warning = 'Checkout files preserved at ' + archive + '. The branch remains.'
    if os.path.lexists(target):
      warning += ' New files at the original path were left in place.'
    result = {'success': True, 'recoveryPath': archive, 'warning': warning}
except Exception as error:
  message = str(error)
  if archive is not None and os.path.isdir(archive):
    message += '\nCheckout files are preserved at ' + archive + '. Git cleanup may be incomplete at ' + stage + '.'
  elif stage is not None and os.path.lexists(stage):
    message += '\nCheckout remains at ' + stage + '; inspect it on the host before retrying.'
  result = {'success': False, 'error': message}
if journal is not None:
  with open(journal + '.completed', 'x') as record:
    json.dump({'state': 'completed', 'result': result}, record)
    record.flush()
    os.fsync(record.fileno())
  os.replace(journal + '.completed', journal)
print(json.dumps(result))
`;

export async function removeSshWorktree(executor: SshCommandExecutor, target: string, workspacePath: string, worktreePath: string, expectedBranch: string | null, activePaths: string[], operationId: string, options: GitWorktreeRemovalOptions = {}): Promise<GitWorktreeRemoveResult & { uncertain?: boolean }> {
  if (!validRemoteWorktreePath(workspacePath) || !validRemoteWorktreePath(worktreePath) ||
      (typeof expectedBranch !== 'string' && expectedBranch !== null) || !Array.isArray(activePaths) || activePaths.length > 1024 ||
      !activePaths.every(validRemoteWorktreePath) || !/^[0-9a-f-]{36}$/.test(operationId)) {
    return { success: false, error: 'Invalid remote worktree removal request' };
  }
  const { stagingPath, recoveryDirectory } = remoteRemovalPaths(worktreePath, operationId);
  try {
    const { stdout } = await executor.exec(target, 'python3', ['-c', REMOVE_SCRIPT, workspacePath, worktreePath, JSON.stringify(activePaths), JSON.stringify(expectedBranch), operationId, JSON.stringify(options.discardIgnored === true)], { timeoutMs: 120000, maxBuffer: 128 * 1024 });
    const result: unknown = JSON.parse(stdout);
    if (!result || typeof result !== 'object' || !('success' in result) || typeof result.success !== 'boolean') throw new Error('Invalid removal response');
    if (result.success) {
      if (!('recoveryPath' in result) || result.recoveryPath !== path.posix.join(recoveryDirectory, 'checkout') ||
          !('warning' in result) || typeof result.warning !== 'string') throw new Error('Invalid recovery response');
      return { success: true, recoveryPath: result.recoveryPath, warning: result.warning };
    }
    if (!('error' in result) || typeof result.error !== 'string') throw new Error('Invalid removal error response');
    return { success: false, error: result.error };
  } catch (error) {
    return { success: false, uncertain: true, error: `${error instanceof Error ? error.message : 'SSH removal failed'}\nRemoval may still be running on the host. Refresh worktrees to verify completion before reopening. Recovery folder: ${recoveryDirectory}; staging path: ${stagingPath}.` };
  }
}

export async function waitForSshWorktreeOperations(executor: SshCommandExecutor, target: string, workspacePath: string, operationId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(operationId)) throw new Error('Invalid removal operation identity');
  const script = WORKTREE_INSPECTION_PYTHON + PRIVATE_DIRECTORY_PYTHON + String.raw`
with repository_lock():
  common = os.fsdecode(git(workspace, ['rev-parse', '--path-format=absolute', '--git-common-dir']).rstrip(b'\n'))
  journal = os.path.join(common, 'clanker-worktree-operations', sys.argv[4] + '.json')
  private_directory(os.path.dirname(journal), 'Operation journal')
  if not canonical(journal):
    sys.exit('Operation journal is not canonical')
  with open(journal) as record:
    value = json.load(record)
  if value.get('state') != 'completed':
    sys.exit('Removal completion is not confirmed; inspect recovery paths on the host')
  print('completed')
`;
  const result = await executor.exec(target, 'python3', ['-c', script, workspacePath, workspacePath, '[]', operationId], { timeoutMs: 120000, maxBuffer: 128 * 1024 });
  if (result.stdout.trim() !== 'completed') throw new Error('Could not verify remote worktree operation completion');
}
