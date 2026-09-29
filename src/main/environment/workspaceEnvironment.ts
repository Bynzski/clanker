import type {
  FileListDirectoryRequest,
  FileListDirectoryResult,
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
import type {
  WorkspaceEnvironmentId,
} from '../../shared/types/environments';

export interface EnvironmentCapabilities {
  readonly watchFiles: boolean;
  readonly worktrees: boolean;
  readonly revealInFileManager: boolean;
  readonly agentAttention: boolean;
  readonly sessionDiscovery: boolean;
  readonly annotationHandoff: boolean;
}

export interface EnvironmentHarnessOption {
  name: string;
  command: string;
  args: string[];
  icon: string;
  env?: Record<string, string>;
}

export interface EnvironmentModelOption {
  id: string;
  label: string;
}

export interface TerminalSpawnRequest {
  id: string;
  workingDir: string;
  harness?: string;
  model?: string;
  initialCommand?: string;
  recipeCommand?: boolean;
}

export interface TerminalSpawnResolved {
  spawnCmd: string;
  spawnArgs: string[];
  cwd: string;
  env: Record<string, string>;
  launchLabel?: string;
  initialCommand?: string;
  harnessId?: string;
  attentionEnabled?: boolean;
}

export interface WorkspaceEnvironment {
  readonly id: WorkspaceEnvironmentId;
  readonly kind: 'local' | 'ssh';
  readonly label: string;
  readonly capabilities: EnvironmentCapabilities;

  // Filesystem operations
  validateWorkspacePath(workspacePath: string): Promise<{ valid: boolean; resolvedPath?: string; error?: string }>;
  listDirectory(request: FileListDirectoryRequest): Promise<FileListDirectoryResult>;
  readFile(request: FileReadRequest): Promise<FileReadResult>;
  writeFile(request: FileWriteRequest): Promise<FileWriteResult>;
  createFile(request: FileCreateRequest): Promise<FileOperationResult>;
  createDirectory(request: FileCreateRequest): Promise<FileOperationResult>;
  deleteEntry(request: FileDeleteRequest): Promise<FileOperationResult>;
  renameEntry(request: FileRenameRequest): Promise<FileOperationResult>;

  // Git operations
  execGit(workspacePath: string, args: string[], timeoutMs?: number): Promise<{ stdout: string; stderr: string }>;

  // Terminal & Harness operations
  getHarnessOptions(): Promise<Record<string, EnvironmentHarnessOption>>;
  probeAvailableHarnessIds(): Promise<string[]>;
  discoverHarnessModels?(harnessId: string): Promise<EnvironmentModelOption[]>;
  resolveTerminalSpawn(params: TerminalSpawnRequest): Promise<TerminalSpawnResolved>;

  dispose?(): Promise<void> | void;
}
