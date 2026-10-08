import { ipcMain } from 'electron';
import type Store from 'electron-store';
import type { StoreSchema } from '../../shared/types/store';
import { GENERATE_COMMIT_MESSAGE } from '../../shared/ipcChannels';
import { toNativePath } from '../../shared/pathNormalize';
import { resolveExistingDirectory } from '../security';
import type { WorkspaceRegistry } from '../workspaceRegistry';
import type { HarnessAccountService } from '../accounts/harnessAccountService';
import { bindHarnessExecution } from '../accounts/accountExecution';
import { executeLocalHarnessCommand } from '../environment/localCommandExecutor';
import { requireSuccess } from '../harnesses/commandExecution';
import { findHarnessProvider } from '../harnesses/registry';
import { buildCommitPrompt, normalizeCommitMessageOutput } from '../aiCommit';
import { buildCommitDiffContext } from '../aiCommitContext';
import type { GitService } from '../gitService';

interface RegisterAiCommitIpcDeps {
  getStore: () => Store<StoreSchema>;
  getGitService: () => GitService;
  getWorkspaceRegistry?: () => WorkspaceRegistry;
  getHarnessAccountService?: () => HarnessAccountService;
}

export function getValidatedWorkspacePath(workspacePath: string | null | undefined): string | null {
  if (typeof workspacePath !== 'string' || !workspacePath.trim()) return null;
  return resolveExistingDirectory(toNativePath(workspacePath, process.platform));
}

export function getInvalidWorkspaceResult() {
  return { success: false, error: 'Workspace path is invalid or not a directory' };
}

export function registerAiCommitIpc(deps: RegisterAiCommitIpcDeps): () => Promise<void> {
  const pending = new Map<string, { controller: AbortController; done: Promise<void> }>();
  let shuttingDown = false;
  ipcMain.handle(GENERATE_COMMIT_MESSAGE, async (event, workspacePath: string, workspaceId?: string) => {
    if (shuttingDown) return { success: false, error: 'Application is shutting down' };
    const registry = deps.getWorkspaceRegistry?.();
    const ws = workspaceId ? registry?.getWorkspace(workspaceId) : null;
    if (registry && !ws) return { success: false, error: 'Select a registered local workspace to generate an AI commit message' };
    if (ws && ws.location.environmentId !== 'local') {
      return { success: false, error: 'AI commit message generation is not supported for remote workspaces in this version' };
    }
    const root = getValidatedWorkspacePath(ws?.location.path ?? workspacePath);
    if (!root) return getInvalidWorkspaceResult();
    const key = workspaceId ?? root;
    if (pending.has(key)) return { success: false, error: 'Commit message generation is already running for this workspace' };
    const controller = new AbortController();
    const abort = () => controller.abort();
    event?.sender?.once('destroyed', abort);
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    pending.set(key, { controller, done });
    const isCurrent = () => !controller.signal.aborted && (!ws || registry?.getWorkspace(ws.workspaceId) === ws);
    try {
      const store = deps.getStore();
      if (!store.get('aiCommitEnabled')) return { success: false, error: 'AI commit message generation is disabled' };
      const provider = findHarnessProvider(store.get('aiCommitProvider'));
      if (!provider?.aiCommit) return { success: false, error: 'Unsupported AI commit provider' };
      const binding = deps.getHarnessAccountService?.().resolveBinding({
        environmentId: 'local', harness: provider.descriptor.id, forLaunch: true,
      });
      // Commit inference has an explicit 90-second budget; normal catalogs retain 30 seconds.
      const execution = bindHarnessExecution({
        executeHarnessCommand: (request, signal) => executeLocalHarnessCommand(request, signal, 90_000),
      }, binding?.environment, controller.signal);
      const git = deps.getGitService();
      const gitPath = ws?.location.path ?? root;
      const collectContext = () => git.getCommitPromptContext(gitPath, 'all');
      const context = ws ? await git.withWorkspace({
        workspaceId: ws.workspaceId, workspacePath: gitPath, environmentId: ws.location.environmentId,
      }, collectContext) : await collectContext();
      if (!context.success) return { success: false, error: context.error || 'Unable to build commit context' };
      const diffSummary = await buildCommitDiffContext(root, context.diffSummary, context.changes);
      const prompt = buildCommitPrompt({
        workspacePath: root, branchName: context.currentBranch, isDetached: context.isDetached,
        changeSummary: context.changes.slice(0, 32).map((change) => `${change.status}: ${change.path.slice(0, 256)}`),
        diffMode: 'working', diffSummary,
      });
      if (!isCurrent()) return { success: false, error: 'Workspace closed during commit message generation' };
      // A catalog is discovery, not authority: preserve explicit selection, or let the CLI use its default.
      const model = store.get('aiCommitModel') || undefined;
      const invocation = provider.aiCommit.buildInvocation({ model, prompt });
      const result = await execution.executor.run({ ...invocation, cwd: root, maxOutputBytes: 1024 * 1024 });
      const output = requireSuccess(result, 'Commit message generation');
      const message = normalizeCommitMessageOutput(provider.aiCommit.parseOutput(output));
      if (!isCurrent()) return { success: false, error: 'Workspace closed during commit message generation' };
      if (!/^(?:feature|feat|fix|restructure|refactor|chore|docs|test|build|ci|perf|style|revert)(?:\([^\r\n()]+\))?!?:\s+\S/.test(message)
        || /<\/?(?:think|thinking|analysis)>/i.test(message) || message.includes('\0')) {
        return { success: false, error: 'The harness did not return a valid commit message. No thinking trace was used.' };
      }
      return { success: true, message };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Commit message generation failed' };
    } finally {
      pending.delete(key);
      event?.sender?.removeListener('destroyed', abort);
      finish();
    }
  });
  return async () => {
    shuttingDown = true;
    const requests = [...pending.values()];
    for (const request of requests) request.controller.abort();
    await Promise.all(requests.map((request) => request.done));
  };
}
