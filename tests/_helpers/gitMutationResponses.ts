import type { GitChangeMutationResult, GitStatusResult } from '../../src/shared/types/git';
import { mainCheckoutContextId } from '../../src/shared/checkoutContext';
import { useCheckoutGitStore } from '../../src/renderer/store/checkoutGitStore';

/** Model the main-owned mutation envelope, separately from renderer manual gitRefresh. */
export function installGitMutationResponses(readStatus: () => Promise<GitStatusResult>) {
  const api = window.electronAPI;
  let sequence = 0;
  const envelope = async (mutate: () => Promise<GitChangeMutationResult>): Promise<GitChangeMutationResult> => {
    const active = useCheckoutGitStore.getState().active!;
    const scope = { workspaceId: active.identity.workspaceId, environmentId: active.identity.environmentId,
      workspacePath: active.identity.root, checkoutContextId: active.identity.contextId ?? (active.identity.workspaceId ? mainCheckoutContextId(active.identity.workspaceId) : undefined), presentationGeneration: active.generation };
    const result = await mutate();
    if (result.status) return result;
    const acquisitionSequence = ++sequence;
    try {
      const status = { ...await readStatus(), ...scope, acquisitionSequence };
      return { ...result, status, refreshError: status.success ? undefined : status.error || 'Status unavailable' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Status unavailable';
      return { ...result, refreshError: message, status: { ...scope, acquisitionSequence, success: false, isRepo: false, currentBranch: null, isDetached: false, changes: [], upstream: null, ahead: 0, behind: 0, error: message } };
    }
  };
  window.electronAPI = { ...window.electronAPI,
    gitStage: (...args) => envelope(() => api.gitStage(...args)),
    gitUnstage: (...args) => envelope(() => api.gitUnstage(...args)),
    gitCommit: (...args) => envelope(() => api.gitCommit(...args)),
  };
}
