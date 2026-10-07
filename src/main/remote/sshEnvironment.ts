import type { GitWorktreeRemovalOptions } from '../../shared/types/git';
import { discoverSshWebServices, type RemoteWebEndpoint } from './sshPortDiscovery';
import { findHarnessProvider, getHarnessProvider, getHarnessProviders } from '../harnesses/registry';
import * as path from 'path';
import type {
  WorkspaceEnvironment,
  EnvironmentCapabilities,
  EnvironmentHarnessOption,
  EnvironmentModelOption,
  TerminalSpawnRequest,
  TerminalSpawnResolved,
} from '../environment/workspaceEnvironment';
import type { RemoteDirectoryListing, SshEnvironmentConfig, WorkspaceEnvironmentId } from '../../shared/types/environments';
import { SshCommandExecutor, SshExecutionError } from './sshCommandExecutor';
import { quotePosixArg, quotePosixCommand } from './posixQuote';
import { isPathContained } from './remotePaths';
import { startSshPortForward } from './sshPortForward';
import { snapshotSshFiles } from './sshFileSnapshot';
import { createSshWorktree } from './sshWorktrees';
import { inspectSshWorktree } from './sshWorktreeInspection';
import { removeSshWorktree, waitForSshWorktreeOperations } from './sshWorktreeRemoval';
import type { RemoteFileSnapshotTargets } from '../../shared/types/remoteFileWatch';
export { isPathContained } from './remotePaths';
import { withoutAttentionEnvironment } from '../agentAttentionAdapters';
import { HARNESS_OPTIONS } from '../harnessCatalog';
import { buildHarnessSpawnArgs } from '../harnessLaunch';
import { executeSshHarnessCommand, openSshHarnessSession } from './sshHarnessCommand';
import type { HarnessCommandRequest } from '../harnesses/commandExecution';
import { prepareSshAttention, remoteAttentionEnvironment, REMOTE_CLI_PATH_SETUP } from './sshAgentAttention';
import { discoverSshSessions } from './sshSessionDiscovery';
import { buildSessionCommand } from '../sessionLaunch';
import type {
  FileListDirectoryRequest,
  FileListDirectoryResult,
  FileExplorerEntry,
} from '../../shared/types/fileExplorer';
import type {
  FileReadRequest,
  FileReadResult,
  FileWriteRequest,
  FileWriteResult,
} from '../../shared/types/editor';
import type {
  FileCreateRequest,
  FileDeleteRequest,
  FileRenameRequest,
  FileOperationResult,
} from '../../shared/types/fileOperations';

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB
const BINARY_DETECTION_BYTES = 8192;
const BROWSE_TIMEOUT_MS = 12000;
const BROWSE_MAX_BYTES = 128 * 1024;
const BROWSE_MAX_PATH_BYTES = 4096;
const BROWSE_MAX_DIRECTORIES = 500;

const HOME_DIRECTORY_SCRIPT = [
  'import json, os, sys',
  'home = os.environ.get("HOME")',
  'if not home or not os.path.isabs(home):',
  '  sys.exit("Remote HOME is unavailable")',
  'home = os.path.realpath(home)',
  'preferred = sys.argv[1] if len(sys.argv) > 1 else ""',
  'initial = None',
  'for candidate in [preferred, os.path.join(home, "workspaces"), home]:',
  '  if not candidate or not os.path.isabs(candidate):',
  '    continue',
  '  try:',
  '    candidate = os.path.realpath(candidate)',
  '    if not os.path.isdir(candidate) or not os.access(candidate, os.R_OK | os.X_OK):',
  '      continue',
  '    with os.scandir(candidate):',
  '      pass',
  '    initial = candidate',
  '    break',
  '  except OSError:',
  '    continue',
  'if initial is None:',
  '  sys.exit("Remote starting directory is unavailable")',
  'print(json.dumps({"homePath": home, "initialPath": initial}))',
].join('\n');

const LIST_DIRECTORIES_SCRIPT = [
  'import json, os, sys',
  'requested = sys.argv[1]',
  'target = os.path.realpath(requested)',
  'if not os.path.isdir(target) or not os.access(target, os.R_OK | os.X_OK):',
  '  sys.exit("Remote directory does not exist")',
  'directories = []',
  'with os.scandir(target) as entries:',
  '  for entry in entries:',
  '    try:',
  '      if entry.is_dir(follow_symlinks=True):',
  '        directories.append({"name": entry.name, "path": os.path.realpath(entry.path)})',
  '        if len(directories) > 500:',
  '          sys.exit("Remote directory has too many subdirectories")',
  '    except OSError:',
  '      continue',
  'directories.sort(key=lambda entry: (entry["name"].casefold(), entry["name"]))',
  'print(json.dumps({"path": target, "parentPath": os.path.dirname(target) if target != "/" else None, "directories": directories}))',
].join('\n');
const CREATE_DIRECTORY_SCRIPT = [
  'import json, os, sys',
  'parent_raw = sys.argv[1]',
  'name_raw = sys.argv[2]',
  'parent = os.path.realpath(parent_raw)',
  'if parent != parent_raw:',
  '  sys.exit("Parent directory must be canonical")',
  'if not os.path.isdir(parent) or not os.access(parent, os.W_OK | os.X_OK):',
  '  sys.exit("Parent directory does not exist or is not writable")',
  'target = os.path.join(parent, name_raw)',
  'if os.path.lexists(target):',
  '  sys.exit("Directory already exists")',
  'try:',
  '  os.mkdir(target, 0o755)',
  'except Exception as e:',
  '  sys.exit(str(e))',
  'real_target = os.path.realpath(target)',
  'if os.path.dirname(real_target) != parent or os.path.basename(real_target) != name_raw:',
  '  sys.exit("Created directory is not a direct child of the parent")',
  'print(json.dumps({"path": real_target}))',
].join('\n');


function canonicalBrowsePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= BROWSE_MAX_PATH_BYTES &&
    path.posix.isAbsolute(value) && path.posix.normalize(value) === value &&
    !/[\x00-\x1f\x7f]/.test(value);
}

function parseBrowseResponse(stdout: string): unknown {
  if (Buffer.byteLength(stdout, 'utf8') > BROWSE_MAX_BYTES) {
    throw new Error('Remote directory response exceeds size limit');
  }
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new Error('Invalid remote directory response');
  }
}

function browseObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validBrowseName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value !== '.' &&
    value !== '..' && !/[/\x00-\x1f\x7f]/.test(value) &&
    Buffer.byteLength(value, 'utf8') <= 255;
}

function validNewDirectoryName(value: unknown): value is string {
  return validBrowseName(value) && !value.includes('\\');
}

function remoteHarnessEnvironment(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {})
    .filter(([key]) => /^[A-Za-z_][A-Za-z_0-9]*$/.test(key) && !key.startsWith('CLANKER_ATTENTION_') && !key.startsWith('CLANKER_REMOTE_ATTENTION_'))
    .map(([key, value]) => `${key}=${quotePosixArg(value)}`)
    .join(' ');
}

function sshProcessEnvironment(): Record<string, string> {
  return withoutAttentionEnvironment(process.env);
}

export class SshEnvironment implements WorkspaceEnvironment {
  public readonly id: WorkspaceEnvironmentId;
  public readonly kind = 'ssh' as const;
  public readonly label: string;
  public readonly target: string;
  public readonly worktreeResourceId: string;
  private readonly defaultWorkspaceRoot?: string;

  public readonly capabilities: EnvironmentCapabilities = {
    watchFiles: true,
    worktrees: true,
    revealInFileManager: false,
    agentAttention: true,
    sessionDiscovery: true,
    annotationHandoff: true,
  };

  constructor(
    config: SshEnvironmentConfig,
    private readonly executor: SshCommandExecutor = new SshCommandExecutor(),
    resourceId?: string
  ) {
    this.id = config.id;
    this.label = config.label;
    this.target = config.target;
    this.worktreeResourceId = resourceId ?? `ssh:${config.target}`;
    this.defaultWorkspaceRoot = config.defaultWorkspaceRoot;
  }

  public snapshotFiles(workspacePath: string, targets: RemoteFileSnapshotTargets, signal?: AbortSignal) {
    return snapshotSshFiles(this.executor, this.target, workspacePath, targets, signal);
  }

  /** Read-only discovery before any workspace root has been registered. */
  public async getHomeDirectory(): Promise<{ homePath: string; initialPath: string }> {
    const args = ['-c', HOME_DIRECTORY_SCRIPT, ...(this.defaultWorkspaceRoot ? [this.defaultWorkspaceRoot] : [])];
    const result = await this.executor.exec(this.target, 'python3', args, {
      timeoutMs: BROWSE_TIMEOUT_MS,
      maxBuffer: BROWSE_MAX_BYTES,
    });
    const value = parseBrowseResponse(result.stdout);
    if (!browseObject(value) || !canonicalBrowsePath(value.homePath) ||
        !canonicalBrowsePath(value.initialPath)) {
      throw new Error('Invalid remote home directory response');
    }
    return { homePath: value.homePath, initialPath: value.initialPath };
  }

  /** Browsing has no registered root; workspace file APIs retain their own confinement. */
  public async listBrowsableDirectories(directoryPath: string): Promise<RemoteDirectoryListing> {
    if (!canonicalBrowsePath(directoryPath)) {
      throw new Error('Invalid remote directory path');
    }
    const result = await this.executor.exec(this.target, 'python3', [
      '-c', LIST_DIRECTORIES_SCRIPT, directoryPath,
    ], { timeoutMs: BROWSE_TIMEOUT_MS, maxBuffer: BROWSE_MAX_BYTES });
    const value = parseBrowseResponse(result.stdout);
    if (!browseObject(value) || !canonicalBrowsePath(value.path) ||
        (value.parentPath !== null && !canonicalBrowsePath(value.parentPath)) ||
        value.parentPath !== (value.path === '/' ? null : path.posix.dirname(value.path)) ||
        !Array.isArray(value.directories) || value.directories.length > BROWSE_MAX_DIRECTORIES ||
        !value.directories.every((entry: unknown) => browseObject(entry) &&
          validBrowseName(entry.name) && canonicalBrowsePath(entry.path))) {
      throw new Error('Invalid remote directory listing response');
    }
    return {
      path: value.path,
      parentPath: value.parentPath,
      directories: value.directories.map((entry: { name: string; path: string }) => ({
        name: entry.name,
        path: entry.path,
      })),
    };
  }
  public async createBrowsableDirectory(parentPath: string, name: string): Promise<{ path: string }> {
    if (!canonicalBrowsePath(parentPath) || (parentPath !== '/' && parentPath.endsWith('/'))) {
      throw new Error('Invalid remote parent directory path');
    }
    if (!validNewDirectoryName(name)) {
      throw new Error('Invalid directory name');
    }
    try {
      const result = await this.executor.exec(this.target, 'python3', [
        '-c', CREATE_DIRECTORY_SCRIPT, parentPath, name,
      ], { timeoutMs: BROWSE_TIMEOUT_MS, maxBuffer: BROWSE_MAX_BYTES });
      const value = parseBrowseResponse(result.stdout);
      if (!browseObject(value) || !canonicalBrowsePath(value.path)) {
        throw new Error('Invalid remote create directory response');
      }
      if (path.posix.dirname(value.path) !== parentPath || path.posix.basename(value.path) !== name) {
        throw new Error('Invalid remote create directory response');
      }
      return { path: value.path };
    } catch (err) {
      if (err instanceof SshExecutionError) {
        throw new Error(err.message.trim() || 'Failed to create remote directory');
      }
      throw err;
    }
  }


  public async validateWorkspacePath(
    workspacePath: string
  ): Promise<{ valid: boolean; resolvedPath?: string; error?: string }> {
    if (!workspacePath || typeof workspacePath !== 'string' || !workspacePath.trim()) {
      return { valid: false, error: 'Remote workspace path is required' };
    }

    const trimmed = workspacePath.trim();
    if (!path.posix.isAbsolute(trimmed)) {
      return { valid: false, error: 'Remote workspace path must be an absolute POSIX path' };
    }

    try {
      const script = `test -d ${quotePosixArg(trimmed)} && cd ${quotePosixArg(trimmed)} && pwd -P`;
      const result = await this.executor.exec(this.target, 'sh', ['-c', script]);
      const canonical = result.stdout.trim();
      if (!canonical) {
        return { valid: false, error: 'Failed to resolve canonical remote directory' };
      }
      return { valid: true, resolvedPath: canonical };
    } catch (err) {
      if (err instanceof SshExecutionError) {
        return { valid: false, error: err.message || 'Remote directory does not exist or is not accessible' };
      }
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async listDirectory(request: FileListDirectoryRequest): Promise<FileListDirectoryResult> {
    if (!isPathContained(request.workspacePath, request.directoryPath)) {
      return {
        success: false,
        entries: [],
        errorCode: 'invalid-path',
        error: 'Directory path is outside workspace root',
      };
    }

    const pythonScript = [
      'import os, sys, json',
      'target, root = sys.argv[1], sys.argv[2]',
      'try:',
      '  real_target = os.path.realpath(target)',
      '  real_root = os.path.realpath(root)',
      '  if not (real_target == real_root or real_target.startswith(real_root.rstrip("/") + "/")):',
      '    sys.exit(2)',
      '  entries = []',
      '  with os.scandir(target) as it:',
      '    for entry in it:',
      '      try:',
      '        st = entry.stat()',
      '        entries.append({',
      '          "name": entry.name,',
      '          "path": os.path.join(target, entry.name),',
      '          "isDirectory": entry.is_dir(),',
      '          "size": st.st_size,',
      '          "modified": int(st.st_mtime * 1000)',
      '        })',
      '      except OSError:',
      '        pass',
      '  entries.sort(key=lambda e: (not e["isDirectory"], e["name"].lower()))',
      '  print(json.dumps(entries))',
      'except Exception as e:',
      '  sys.stderr.write(str(e))',
      '  sys.exit(1)',
    ].join('\n');

    try {
      const result = await this.executor.exec(this.target, 'python3', [
        '-c', pythonScript, request.directoryPath, request.workspacePath,
      ]);
      const entries = JSON.parse(result.stdout) as FileExplorerEntry[];
      return { success: true, entries };
    } catch (err) {
      if (err instanceof SshExecutionError && err.exitCode === 2) {
        return { success: false, entries: [], errorCode: 'invalid-path', error: 'Directory escapes workspace root' };
      }
      return { success: false, entries: [], errorCode: 'unknown', error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async readFile(request: FileReadRequest): Promise<FileReadResult> {
    if (!isPathContained(request.workspacePath, request.filePath)) {
      return { success: false, errorCode: 'invalid-path', error: 'File path is outside workspace root' };
    }

    const pythonScript = [
      'import os, sys, base64',
      'target, root = sys.argv[1], sys.argv[2]',
      'try:',
      '  real_target = os.path.realpath(target)',
      '  real_root = os.path.realpath(root)',
      '  if not (real_target == real_root or real_target.startswith(real_root.rstrip("/") + "/")):',
      '    sys.exit(2)',
      '  if not os.path.isfile(real_target):',
      '    sys.exit(3)',
      '  size = os.path.getsize(real_target)',
      `  if size > ${MAX_FILE_SIZE}:`,
      '    sys.exit(4)',
      '  with open(real_target, "rb") as f:',
      `    chunk = f.read(${BINARY_DETECTION_BYTES})`,
      '    if b"\\0" in chunk:',
      '      sys.exit(5)',
      '    f.seek(0)',
      '    content = f.read()',
      '    sys.stdout.buffer.write(base64.b64encode(content))',
      'except Exception as e:',
      '  sys.stderr.write(str(e))',
      '  sys.exit(1)',
    ].join('\n');

    try {
      const result = await this.executor.exec(this.target, 'python3', [
        '-c', pythonScript, request.filePath, request.workspacePath,
      ]);
      const base64Data = result.stdout.trim();
      const content = Buffer.from(base64Data, 'base64').toString('utf8');
      return { success: true, content };
    } catch (err) {
      if (err instanceof SshExecutionError) {
        if (err.exitCode === 2) return { success: false, errorCode: 'invalid-path', error: 'File path escapes workspace root' };
        if (err.exitCode === 3) return { success: false, errorCode: 'not-found', error: 'File not found or is a directory' };
        if (err.exitCode === 4) return { success: false, errorCode: 'file-too-large', error: `File exceeds maximum size of ${MAX_FILE_SIZE} bytes` };
        if (err.exitCode === 5) return { success: false, errorCode: 'binary-file', error: 'Binary file cannot be opened in editor' };
      }
      return { success: false, errorCode: 'read-error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async writeFile(request: FileWriteRequest): Promise<FileWriteResult> {
    if (!isPathContained(request.workspacePath, request.filePath)) {
      return { success: false, errorCode: 'invalid-path', error: 'File path is outside workspace root' };
    }

    const fileBuffer = Buffer.from(request.content, 'utf8');
    const pythonScript = [
      'import os, stat, sys, tempfile',
      'target, root = sys.argv[1], sys.argv[2]',
      'tmp_path = None',
      'try:',
      '  target_dir = os.path.dirname(os.path.abspath(target))',
      '  real_dir = os.path.realpath(target_dir)',
      '  real_root = os.path.realpath(root)',
      '  if not (real_dir == real_root or real_dir.startswith(real_root.rstrip("/") + "/")):',
      '    sys.exit(2)',
      '  existing_mode = None',
      '  if os.path.lexists(target):',
      '    existing_stat = os.lstat(target)',
      '    if stat.S_ISLNK(existing_stat.st_mode):',
      '      sys.exit(3)',
      '    if stat.S_ISREG(existing_stat.st_mode):',
      '      existing_mode = stat.S_IMODE(existing_stat.st_mode)',
      '  fd, tmp_path = tempfile.mkstemp(prefix=".clanker-", dir=target_dir)',
      '  with os.fdopen(fd, "wb") as f:',
      '    f.write(sys.stdin.buffer.read())',
      '  if existing_mode is None:',
      '    # A new text file uses the SSH user\'s umask, not mkstemp\'s 0600.',
      '    mask = os.umask(0)',
      '    os.umask(mask)',
      '    existing_mode = 0o666 & ~mask',
      '  os.chmod(tmp_path, existing_mode)',
      '  os.replace(tmp_path, target)',
      '  tmp_path = None',
      'except Exception as e:',
      '  sys.stderr.write(str(e))',
      '  sys.exit(1)',
      'finally:',
      '  if tmp_path and os.path.exists(tmp_path):',
      '    os.unlink(tmp_path)',
    ].join('\n');

    try {
      await this.executor.exec(this.target, 'python3', [
        '-c', pythonScript, request.filePath, request.workspacePath,
      ], { input: fileBuffer });
      return { success: true };
    } catch (err) {
      if (err instanceof SshExecutionError && err.exitCode === 2) {
        return { success: false, errorCode: 'invalid-path', error: 'Target directory is outside workspace root' };
      }
      if (err instanceof SshExecutionError && err.exitCode === 3) {
        return { success: false, errorCode: 'invalid-path', error: 'File path is a symbolic link' };
      }
      return { success: false, errorCode: 'write-error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async createFile(request: FileCreateRequest): Promise<FileOperationResult> {
    if (!isPathContained(request.workspacePath, request.targetPath)) {
      return { success: false, error: 'Target path is outside workspace root' };
    }

    const pythonScript = [
      'import os, sys',
      'target, root = sys.argv[1], sys.argv[2]',
      'try:',
      '  parent_dir = os.path.dirname(os.path.abspath(target))',
      '  real_root = os.path.realpath(root)',
      '  real_parent = os.path.realpath(parent_dir)',
      '  if not (real_parent == real_root or real_parent.startswith(real_root.rstrip("/") + "/")):',
      '    sys.exit(2)',
      '  os.makedirs(parent_dir, exist_ok=True)',
      '  real_parent = os.path.realpath(parent_dir)',
      '  if not (real_parent == real_root or real_parent.startswith(real_root.rstrip("/") + "/")):',
      '    sys.exit(2)',
      '  with open(target, "x"):',
      '    pass',
      'except Exception as e:',
      '  sys.stderr.write(str(e))',
      '  sys.exit(1)',
    ].join('\n');

    try {
      await this.executor.exec(this.target, 'python3', ['-c', pythonScript, request.targetPath, request.workspacePath]);
      return { success: true };
    } catch (err) {
      if (err instanceof SshExecutionError && err.exitCode === 2) {
        return { success: false, error: 'Target directory escapes workspace root' };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async createDirectory(request: FileCreateRequest): Promise<FileOperationResult> {
    if (!isPathContained(request.workspacePath, request.targetPath)) {
      return { success: false, error: 'Target path is outside workspace root' };
    }

    const pythonScript = [
      'import os, sys',
      'target, root = sys.argv[1], sys.argv[2]',
      'try:',
      '  real_root = os.path.realpath(root)',
      '  real_target = os.path.realpath(target)',
      '  if not (real_target == real_root or real_target.startswith(real_root.rstrip("/") + "/")):',
      '    sys.exit(2)',
      '  os.makedirs(target, exist_ok=True)',
      '  real_target = os.path.realpath(target)',
      '  if not (real_target == real_root or real_target.startswith(real_root.rstrip("/") + "/")):',
      '    sys.exit(2)',
      'except Exception as e:',
      '  sys.stderr.write(str(e))',
      '  sys.exit(1)',
    ].join('\n');

    try {
      await this.executor.exec(this.target, 'python3', ['-c', pythonScript, request.targetPath, request.workspacePath]);
      return { success: true };
    } catch (err) {
      if (err instanceof SshExecutionError && err.exitCode === 2) {
        return { success: false, error: 'Target directory escapes workspace root' };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async deleteEntry(request: FileDeleteRequest): Promise<FileOperationResult> {
    if (!isPathContained(request.workspacePath, request.targetPath)) {
      return { success: false, error: 'Target path is outside workspace root' };
    }

    const normRoot = path.posix.normalize(request.workspacePath).replace(/\/+$/, '');
    const normTarget = path.posix.normalize(request.targetPath).replace(/\/+$/, '');
    if (normRoot === normTarget) {
      return { success: false, error: 'Cannot delete the workspace root directory' };
    }

    const pythonScript = [
      'import os, sys, shutil',
      'target, root = sys.argv[1], sys.argv[2]',
      'try:',
      '  real_target = os.path.realpath(target)',
      '  real_root = os.path.realpath(root)',
      '  if real_target == real_root:',
      '    sys.exit(3)',
      '  if not real_target.startswith(real_root.rstrip("/") + "/"):',
      '    sys.exit(2)',
      '  if os.path.islink(target) or os.path.isfile(target):',
      '    os.unlink(target)',
      '  elif os.path.isdir(target):',
      '    shutil.rmtree(target)',
      'except Exception as e:',
      '  sys.stderr.write(str(e))',
      '  sys.exit(1)',
    ].join('\n');

    try {
      await this.executor.exec(this.target, 'python3', ['-c', pythonScript, request.targetPath, request.workspacePath]);
      return { success: true };
    } catch (err) {
      if (err instanceof SshExecutionError) {
        if (err.exitCode === 3) return { success: false, error: 'Cannot delete the workspace root directory' };
        if (err.exitCode === 2) return { success: false, error: 'Target escapes workspace root' };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async renameEntry(request: FileRenameRequest): Promise<FileOperationResult> {
    if (!isPathContained(request.workspacePath, request.oldPath)) {
      return { success: false, error: 'Source path is outside workspace root' };
    }
    const normRoot = path.posix.normalize(request.workspacePath).replace(/\/+$/, '');
    const normOld = path.posix.normalize(request.oldPath).replace(/\/+$/, '');
    if (normRoot === normOld) {
      return { success: false, error: 'Cannot rename the workspace root directory' };
    }
    if (!isPathContained(request.workspacePath, request.newPath)) {
      return { success: false, error: 'Destination path is outside workspace root' };
    }

    const pythonScript = [
      'import os, sys',
      'old_path, new_path, root = sys.argv[1], sys.argv[2], sys.argv[3]',
      'try:',
      '  real_root = os.path.realpath(root)',
      '  real_old = os.path.realpath(old_path)',
      '  if real_old == real_root:',
      '    sys.exit(3)',
      '  if not real_old.startswith(real_root.rstrip("/") + "/"):',
      '    sys.exit(2)',
      '  new_parent = os.path.dirname(os.path.abspath(new_path))',
      '  real_new_parent = os.path.realpath(new_parent)',
      '  if not (real_new_parent == real_root or real_new_parent.startswith(real_root.rstrip("/") + "/")):',
      '    sys.exit(2)',
      '  os.makedirs(new_parent, exist_ok=True)',
      '  real_new_parent = os.path.realpath(new_parent)',
      '  if not (real_new_parent == real_root or real_new_parent.startswith(real_root.rstrip("/") + "/")):',
      '    sys.exit(2)',
      '  os.replace(old_path, new_path)',
      'except Exception as e:',
      '  sys.stderr.write(str(e))',
      '  sys.exit(1)',
    ].join('\n');

    try {
      await this.executor.exec(this.target, 'python3', ['-c', pythonScript, request.oldPath, request.newPath, request.workspacePath]);
      return { success: true };
    } catch (err) {
      if (err instanceof SshExecutionError && err.exitCode === 2) {
        return { success: false, error: 'Path escapes workspace root' };
      }
      if (err instanceof SshExecutionError && err.exitCode === 3) {
        return { success: false, error: 'Cannot rename the workspace root directory' };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public createWorktree(workspacePath: string, baseRef: string, branch: string) {
    return createSshWorktree(this.executor, this.target, workspacePath, baseRef, branch);
  }

  public inspectWorktree(workspacePath: string, worktreePath: string, activePaths: string[]) {
    return inspectSshWorktree(this.executor, this.target, workspacePath, worktreePath, activePaths);
  }

  public removeWorktree(workspacePath: string, worktreePath: string, expectedBranch: string | null, activePaths: string[], operationId: string, options: GitWorktreeRemovalOptions = {}) {
    return removeSshWorktree(this.executor, this.target, workspacePath, worktreePath, expectedBranch, activePaths, operationId, options);
  }

  public waitForWorktreeOperations(workspacePath: string, operationId: string) {
    return waitForSshWorktreeOperations(this.executor, this.target, workspacePath, operationId);
  }

  public async execGit(
    workspacePath: string,
    args: string[],
    timeoutMs = 15000
  ): Promise<{ stdout: string; stderr: string }> {
    return this.executor.exec(this.target, 'git', args, {
      cwd: workspacePath,
      timeoutMs,
      remoteEnv: { GIT_TERMINAL_PROMPT: '0' },
    });
  }

  public executeHarnessCommand(request: HarnessCommandRequest, signal?: AbortSignal) {
    return executeSshHarnessCommand(this.executor, this.target, request, signal);
  }

  public openHarnessCommandSession(request: HarnessCommandRequest, signal?: AbortSignal) {
    return openSshHarnessSession(this.executor, this.target, request, signal);
  }

  public async probeAvailableHarnessIds(): Promise<string[]> {
    const candidates = getHarnessProviders();
    const script = [
      REMOTE_CLI_PATH_SETUP,
      ...candidates.map((provider) => `command -v ${quotePosixArg(provider.launch.command)} >/dev/null 2>&1 && printf '%s\\n' ${quotePosixArg(provider.descriptor.id)}`),
      ':', // An absent last candidate must not make the whole probe fail.
    ].join('\n');

    try {
      const result = await this.executor.exec(this.target, 'sh', ['-c', script], { timeoutMs: 5000 });
      const found = result.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      return found;
    } catch {
      return [];
    }
  }

  public async getHarnessOptions(): Promise<Record<string, EnvironmentHarnessOption>> {
    const available = await this.probeAvailableHarnessIds();
    const availableSet = new Set(available);
    const options: Record<string, EnvironmentHarnessOption> = {};

    for (const [id, opt] of Object.entries(HARNESS_OPTIONS)) {
      if (availableSet.has(id)) {
        options[id] = opt;
      }
    }
    return options;
  }

  public discoverWebServices(signal?: AbortSignal, hints?: RemoteWebEndpoint[]) {
    return discoverSshWebServices(this.executor, this.target, signal, hints);
  }

  public startPortForward(localPort: number, remotePort: number, signal: AbortSignal, onExit: (error: string) => void, remoteHost?: '127.0.0.1' | '::1') {
    return startSshPortForward(this.target, localPort, remotePort, signal, onExit, remoteHost);
  }

  public async discoverSessions(workspacePath: string, scopes: readonly string[] = []) {
    return discoverSshSessions(this.executor, this.target, workspacePath, await this.probeAvailableHarnessIds(), scopes);
  }

  /**
   * The provider picks the command and parser; this host runs it through the bound executor. A
   * harness without environment-bound discovery, or any failure, yields no catalog: neither the
   * desktop cache nor a provider's static fallback describes what exists on this server.
   */
  public async discoverHarnessModels(harnessId: string): Promise<EnvironmentModelOption[]> {
    const discover = findHarnessProvider(harnessId)?.models?.discoverInEnvironment;
    if (!discover) return [];
    try {
      return await discover({ run: (request) => this.executeHarnessCommand(request) });
    } catch {
      return [];
    }
  }

  public async resolveTerminalSpawn(params: TerminalSpawnRequest): Promise<TerminalSpawnResolved> {
    const harnessConfig = params.harness ? HARNESS_OPTIONS[params.harness] : undefined;
    const remoteScript: string[] = [];
    if (params.resumeSession) {
      const { session, workspaceRoot } = params.resumeSession;
      if (!harnessConfig || session.harness !== params.harness || session.cwd !== params.workingDir) throw new Error('Invalid remote session launch');
      const check = `import os,sys\nroot,cwd,file,session_store=sys.argv[1:]\nif not os.path.isdir(root) or os.path.realpath(root)!=root or not os.path.isdir(cwd) or os.path.realpath(cwd)!=cwd or not (cwd==root or cwd.startswith(root.rstrip('/')+'/')): sys.exit('Remote session directory is no longer within the workspace')\nif session_store:\n store=os.path.join(os.path.realpath(os.path.expanduser('~')),session_store)\n if not file.endswith('.jsonl') or not os.path.isfile(file) or os.path.realpath(file)!=file or os.path.realpath(store)!=store or not file.startswith(store+'/'): sys.exit('Remote session file is no longer valid')\n`;
      remoteScript.push(`${quotePosixCommand('python3', ['-c', check, workspaceRoot, session.cwd, session.filePath ?? '', getHarnessProvider(session.harness).sessions?.remote?.fileStore ?? ''])} || exit 1`);
    }
    remoteScript.push(
      `cd ${quotePosixArg(params.workingDir)} || exit 1`,
      REMOTE_CLI_PATH_SETUP,
      `for clanker_key in $(env | sed -n 's/^\\(CLANKER_\\(REMOTE_\\)\\{0,1\\}ATTENTION_[A-Za-z_0-9]*\\)=.*/\\1/p'); do unset "$clanker_key"; done`,
    );

    let attention: Awaited<ReturnType<typeof prepareSshAttention>> | undefined;
    if (harnessConfig && params.harness) {
      let harnessArgs = params.resumeSession
        ? buildSessionCommand(params.resumeSession.session, { operation: params.resumeSession.fork ? 'fork' : 'resume', transport: 'ssh', userFlags: params.flags }).args
        : buildHarnessSpawnArgs(harnessConfig, params.model, params.flags, findHarnessProvider(params.harness)?.launch.modelArgs);
      if (params.attentionToken) {
        attention = await prepareSshAttention(this.executor, this.target, params.harness, harnessArgs, params.attentionToken, { rootSessionId: params.attentionRootSessionId });
        harnessArgs = attention.args;
      }
      const harnessEnv = [remoteHarnessEnvironment(harnessConfig.env), attention ? remoteAttentionEnvironment(attention.env) : ''].filter(Boolean).join(' ');
      const quotedHarness = quotePosixCommand(harnessConfig.command, harnessArgs);
      // Keep the foreground CLI interactive, then leave a usable shell on exit.
      if (attention) remoteScript.push(`trap ${quotePosixArg(attention.endCommand)} EXIT HUP TERM`);
      remoteScript.push(`(${harnessEnv ? `${harnessEnv} ` : ''}${quotedHarness} || true)`);
      if (attention) remoteScript.push(attention.endCommand, 'trap - EXIT HUP TERM');
    } else if (params.initialCommand) {
      remoteScript.push(`sh -c ${quotePosixArg(params.initialCommand)}`);
    }
    remoteScript.push('exec "${SHELL:-/bin/bash}" -l');
    const remoteExec = `sh -c ${quotePosixArg(remoteScript.join('\n'))}`;
    let launchLabel: string | undefined;
    if (harnessConfig && params.harness) {
      launchLabel = `[clanker-grid@${this.label}] ${harnessConfig.command}`;
    } else if (params.initialCommand) {
      launchLabel = `[clanker-grid@${this.label}] ${params.initialCommand.trim().replace(/[\r\n]+/g, ' ')}`;
    }

    return {
      spawnCmd: 'ssh',
      spawnArgs: ['-t', this.target, remoteExec],
      cwd: process.cwd(),
      env: {
        ...sshProcessEnvironment(),
        TERM: 'xterm-256color',
      },
      launchLabel,
      initialCommand: undefined, // Embedded directly into ssh remoteExec; avoid duplicate PTY stdin replay
      harnessId: harnessConfig ? params.harness : undefined,
      attentionEnabled: Boolean(attention),
      releaseAttention: attention?.release,
    };
  }
}
