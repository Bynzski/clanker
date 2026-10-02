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
import type { RemoteWebService } from '../../shared/types/remotePreview';
import type { RemoteWebEndpoint } from '../remote/sshPortDiscovery';
import type { PortForwardHandle } from '../remote/sshPortForward';
import type { ExecuteHarnessCommand, OpenHarnessCommandSession } from '../harnesses/commandExecution';
import type { HarnessSession } from '../../shared/types/session';
import type { RemoteFileSnapshot, RemoteFileSnapshotTargets } from '../../shared/types/remoteFileWatch';
import type { GitWorktreeCreateResult, GitWorktreeInspectionResult, GitWorktreeRemoveResult } from '../../shared/types/git';

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
  flags?: string;
  initialCommand?: string;
  recipeCommand?: boolean;
  /** Main-generated per-launch credential; never supplied by the renderer. */
  attentionToken?: string;
  /** Main-selected native session; never passed directly from renderer payloads. */
  resumeSession?: { session: HarnessSession; fork: boolean; workspaceRoot: string };
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
  releaseAttention?: () => Promise<void>;
}

export interface WorkspaceEnvironment {
  readonly id: WorkspaceEnvironmentId;
  readonly kind: 'local' | 'ssh';
  readonly label: string;
  /** Saved environments using the same transport share removal safeguards. */
  readonly worktreeResourceId?: string;
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
  snapshotFiles?(workspacePath: string, targets: RemoteFileSnapshotTargets, signal?: AbortSignal): Promise<RemoteFileSnapshot>;

  // Git operations
  execGit(workspacePath: string, args: string[], timeoutMs?: number): Promise<{ stdout: string; stderr: string }>;
  createWorktree?(workspacePath: string, baseRef: string, branch: string): Promise<GitWorktreeCreateResult>;
  inspectWorktree?(workspacePath: string, worktreePath: string, activePaths: string[]): Promise<GitWorktreeInspectionResult>;
  removeWorktree?(workspacePath: string, worktreePath: string, expectedBranch: string | null, activePaths: string[], operationId: string): Promise<GitWorktreeRemoveResult & { uncertain?: boolean }>;
  waitForWorktreeOperations?(workspacePath: string, operationId: string): Promise<void>;

  // Terminal & Harness operations
  getHarnessOptions(): Promise<Record<string, EnvironmentHarnessOption>>;
  probeAvailableHarnessIds(): Promise<string[]>;
  discoverHarnessModels?(harnessId: string): Promise<EnvironmentModelOption[]>;
  discoverSessions?(workspacePath: string): Promise<HarnessSession[]>;
  /**
   * Bounded command execution in this environment (local process or the saved
   * SSH target). Harness capabilities such as usage run through this; they never
   * receive transport details. Absent means the environment cannot run probes.
   */
  executeHarnessCommand?: ExecuteHarnessCommand;
  /** Interactive bounded stdio session in this environment (stateful line protocols). */
  openHarnessCommandSession?: OpenHarnessCommandSession;
  resolveTerminalSpawn(params: TerminalSpawnRequest): Promise<TerminalSpawnResolved>;

  discoverWebServices?(signal?: AbortSignal, hints?: RemoteWebEndpoint[]): Promise<RemoteWebService[]>;

  startPortForward?(localPort: number, remotePort: number, signal: AbortSignal, onExit: (error: string) => void, remoteHost?: '127.0.0.1' | '::1'): Promise<PortForwardHandle>;

  dispose?(): Promise<void> | void;
}
