import * as path from 'path';
import type { GitWorktreeCreateResult } from '../../shared/types/git';
import { worktreeDirectoryName } from '../worktreePaths';
import { SshCommandExecutor, SshExecutionError } from './sshCommandExecutor';

// Run validation and creation together on the host. Reserve the destination
// exclusively, and never recursively delete partial output after a failed add.
const CREATE_SCRIPT = String.raw`
import json, os, re, stat, subprocess, sys
workspace, base, branch, directory = sys.argv[1:]
os.environ['GIT_TERMINAL_PROMPT'] = '0'
def git(args, check=True):
  result = subprocess.run(['git', '-C', workspace] + args, capture_output=True, timeout=110)
  if check and result.returncode:
    raise RuntimeError(result.stderr.decode('utf-8', 'replace').strip() or 'Remote Git command failed')
  if not check and result.returncode not in (0, 1):
    raise RuntimeError(result.stderr.decode('utf-8', 'replace').strip() or 'Remote Git command failed')
  return result
def canonical(value):
  return os.path.isabs(value) and os.path.normpath(value) == value and os.path.realpath(value) == value
try:
  if not canonical(workspace) or not os.path.isdir(workspace):
    raise RuntimeError('Registered workspace is no longer a canonical directory')
  git(['check-ref-format', '--branch', branch])
  records = git(['worktree', 'list', '--porcelain', '-z']).stdout.split(b'\0\0')
  first = records[0].split(b'\0')
  root = next((os.fsdecode(line[9:]) for line in first if line.startswith(b'worktree ')), '')
  if not root or not canonical(root) or not os.path.isdir(root) or os.path.basename(root) == '':
    raise RuntimeError('Repository main worktree is unavailable or not canonical')
  existing = git(['show-ref', '--verify', '--quiet', 'refs/heads/' + branch], False).returncode == 0
  if existing and any(b'branch refs/heads/' + branch.encode() in record.split(b'\0') for record in records):
    raise RuntimeError('Branch already has a worktree')
  commit = ''
  if not existing:
    if not base or base.startswith('-'):
      raise RuntimeError('Choose a valid base ref for the new branch')
    ref = 'refs/heads/' + base
    if base.startswith('refs/') or git(['show-ref', '--verify', '--quiet', ref], False).returncode:
      ref = base
    commit = git(['rev-parse', '--verify', '--quiet', ref + '^{commit}']).stdout.decode().strip()
    if not re.fullmatch('[0-9a-fA-F]{40,64}', commit):
      raise RuntimeError('Base ref does not resolve to a commit')
  parent = os.path.join(os.path.dirname(root), os.path.basename(root) + '-worktrees')
  created_parent = False
  try:
    os.mkdir(parent, 0o755)
    created_parent = True
  except FileExistsError:
    pass
  if not stat.S_ISDIR(os.lstat(parent).st_mode) or not canonical(parent):
    raise RuntimeError('Worktree parent is not a canonical regular directory')
  destination = os.path.join(parent, directory)
  if len(os.fsencode(destination)) > 4096:
    raise RuntimeError('Worktree destination path is too long')
  # mkdir refuses existing directories, files, and dangling symlinks. Git may
  # populate only this empty directory reserved by the current request.
  os.mkdir(destination, 0o755)
  try:
    if not canonical(destination):
      raise RuntimeError('Worktree destination is no longer canonical')
    args = ['worktree', 'add', destination, branch] if existing else ['worktree', 'add', '-b', branch, destination, commit]
    git(args)
  except Exception as error:
    # Only remove an empty unregistered directory. On uncertainty keep it;
    # disconnects and timeouts must never cause destructive cleanup.
    try:
      listed = git(['worktree', 'list', '--porcelain', '-z']).stdout
      if b'worktree ' + os.fsencode(destination) + b'\0' not in listed:
        os.rmdir(destination)
      if created_parent:
        os.rmdir(parent)
    except Exception:
      pass
    raise RuntimeError(str(error) + '\nCreation failed at ' + destination + '; refresh worktrees before retrying. Any partial checkout or branch was preserved.')
  print(json.dumps({'path': destination}))
except Exception as error:
  sys.exit(str(error))
`;

export async function createSshWorktree(executor: SshCommandExecutor, target: string, workspacePath: string, baseRef: string, name: string): Promise<GitWorktreeCreateResult> {
  if (typeof name !== 'string' || typeof baseRef !== 'string') return { success: false, error: 'Invalid worktree branch or base ref' };
  const branch = name.trim();
  const base = baseRef.trim();
  if (!branch || branch.startsWith('-') || /[\x00-\x1f\x7f]/.test(branch) || Buffer.byteLength(branch) > 1024 ||
      /[\x00-\x1f\x7f]/.test(base) || Buffer.byteLength(base) > 4096) {
    return { success: false, error: 'Choose a valid worktree branch and base ref' };
  }
  try {
    const { stdout } = await executor.exec(target, 'python3', ['-c', CREATE_SCRIPT, workspacePath, base, branch, worktreeDirectoryName(branch)], { timeoutMs: 120000, maxBuffer: 128 * 1024 });
    const value: unknown = JSON.parse(stdout);
    const destination = value && typeof value === 'object' && 'path' in value ? value.path : undefined;
    if (typeof destination !== 'string' || !path.posix.isAbsolute(destination) || path.posix.normalize(destination) !== destination ||
        Buffer.byteLength(destination) > 4096 || path.posix.basename(destination) !== worktreeDirectoryName(branch)) {
      throw new Error('Invalid remote worktree creation response');
    }
    return { success: true, worktree: { path: destination, branch, isMain: false, isLocked: false, isPrunable: false } };
  } catch (error) {
    const message = error instanceof SshExecutionError ? error.stderr.trim() || error.message : error instanceof Error ? error.message : 'Could not create remote worktree';
    return { success: false, error: `${message}\nRefresh worktrees before retrying; the SSH operation may have completed on the host.` };
  }
}
