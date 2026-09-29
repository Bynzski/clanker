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
import { HARNESS_OPTIONS } from '../harnessCatalog';
import { buildHarnessSpawnArgs } from '../harnessLaunch';
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
  'if not os.path.isdir(home) or not os.access(home, os.R_OK | os.X_OK):',
  '  sys.exit("Remote HOME is not a directory")',
  'with os.scandir(home):',
  '  pass',
  'initial = os.path.join(home, "workspaces")',
  'try:',
  '  if not os.access(initial, os.R_OK | os.X_OK):',
  '    raise PermissionError("Remote workspaces directory is inaccessible")',
  '  with os.scandir(initial):',
  '    pass',
  '  initial = os.path.realpath(initial)',
  'except OSError:',
  '  initial = home',
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

// A noninteractive SSH command does not reliably receive the account's login
// PATH. Source only the POSIX login profile (never an interactive shell rc),
// then add the same user CLI directories as the local harness wrapper.
const REMOTE_CLI_PATH_SETUP = [
  'if [ -r "$HOME/.profile" ]; then . "$HOME/.profile" >/dev/null; fi',
  'for clanker_bin in "$HOME/bin" "$HOME/.npm-packages/bin" "$HOME/.local/bin" "$HOME/.npm-global/bin"; do',
  '  case ":$PATH:" in *":$clanker_bin:"*) ;; *) PATH="$clanker_bin:$PATH" ;; esac',
  'done',
  'export PATH',
].join('\n');

function remoteHarnessEnvironment(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {})
    .filter(([key]) => /^[A-Za-z_][A-Za-z_0-9]*$/.test(key) && !key.startsWith('CLANKER_ATTENTION_'))
    .map(([key, value]) => `${key}=${quotePosixArg(value)}`)
    .join(' ');
}

function sshProcessEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith('CLANKER_ATTENTION_'))
  ) as Record<string, string>;
}

export function isPathContained(rootPath: string, candidatePath: string): boolean {
  if (!rootPath || !candidatePath) return false;
  const normRoot = path.posix.normalize(rootPath).replace(/\/+$/, '') || '/';
  const normCandidate = path.posix.normalize(candidatePath).replace(/\/+$/, '') || '/';

  if (!path.posix.isAbsolute(normCandidate)) return false;
  if (normRoot === normCandidate) return true;
  if (normRoot === '/') return true;

  const relative = path.posix.relative(normRoot, normCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.posix.isAbsolute(relative));
}

export class SshEnvironment implements WorkspaceEnvironment {
  public readonly id: WorkspaceEnvironmentId;
  public readonly kind = 'ssh' as const;
  public readonly label: string;
  public readonly target: string;

  public readonly capabilities: EnvironmentCapabilities = {
    watchFiles: false,
    worktrees: false,
    revealInFileManager: false,
    agentAttention: false,
    sessionDiscovery: false,
    annotationHandoff: false,
  };

  constructor(
    config: SshEnvironmentConfig,
    private readonly executor: SshCommandExecutor = new SshCommandExecutor()
  ) {
    this.id = config.id;
    this.label = config.label;
    this.target = config.target;
  }

  /** Read-only discovery before any workspace root has been registered. */
  public async getHomeDirectory(): Promise<{ homePath: string; initialPath: string }> {
    const result = await this.executor.exec(this.target, 'python3', ['-c', HOME_DIRECTORY_SCRIPT], {
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
      'import os, sys, tempfile',
      'target, root = sys.argv[1], sys.argv[2]',
      'tmp_path = None',
      'try:',
      '  target_dir = os.path.dirname(os.path.abspath(target))',
      '  real_dir = os.path.realpath(target_dir)',
      '  real_root = os.path.realpath(root)',
      '  if not (real_dir == real_root or real_dir.startswith(real_root.rstrip("/") + "/")):',
      '    sys.exit(2)',
      '  fd, tmp_path = tempfile.mkstemp(prefix=".clanker-", dir=target_dir)',
      '  with os.fdopen(fd, "wb") as f:',
      '    f.write(sys.stdin.buffer.read())',
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

  public async probeAvailableHarnessIds(): Promise<string[]> {
    const candidates = ['codex', 'claude', 'opencode', 'pi', 'omp', 'hermes', 'agy'];
    const script = [
      REMOTE_CLI_PATH_SETUP,
      ...candidates.map((cmd) => `command -v ${quotePosixArg(cmd)} >/dev/null 2>&1 && printf '%s\\n' ${quotePosixArg(cmd)}`),
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

  public async discoverHarnessModels(): Promise<EnvironmentModelOption[]> {
    // Model discovery is best-effort. Return empty array to use harness defaults on remote host
    return [];
  }

  public async resolveTerminalSpawn(params: TerminalSpawnRequest): Promise<TerminalSpawnResolved> {
    const harnessConfig = params.harness ? HARNESS_OPTIONS[params.harness] : undefined;
    const remoteScript = [
      `cd ${quotePosixArg(params.workingDir)} || exit 1`,
      REMOTE_CLI_PATH_SETUP,
      'unset CLANKER_ATTENTION_PORT CLANKER_ATTENTION_TOKEN CLANKER_ATTENTION_HARNESS CLANKER_ATTENTION_COMMAND',
    ];

    if (harnessConfig && params.harness) {
      const harnessArgs = buildHarnessSpawnArgs(harnessConfig, params.model, params.flags);
      const harnessEnv = remoteHarnessEnvironment(harnessConfig.env);
      const quotedHarness = quotePosixCommand(harnessConfig.command, harnessArgs);
      // Keep the foreground CLI interactive, then leave a usable shell on exit.
      remoteScript.push(`(${harnessEnv ? `${harnessEnv} ` : ''}${quotedHarness} || true)`);
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
      attentionEnabled: false, // Agent Attention disabled for remote terminals in V1
    };
  }
}
