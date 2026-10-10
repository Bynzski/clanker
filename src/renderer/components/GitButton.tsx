import { Button } from './ui/Button';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, GitBranch as GitBranchIcon } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useVcsStore } from '../store/vcsStore';
import { sameWorkspacePath } from '../lib/pathUtils';
import { selectedVcsCheckoutId, currentVcsCheckoutId } from '../lib/vcsCheckout';
import { useAgentLocation } from '../lib/useAgentLocation';
import CommitDialog from './CommitDialog';
import { GitDeleteBranchDialog } from './git/GitDeleteBranchDialog';
import { GitInitMenu } from './git/GitInitMenu';
import { GitRepoMenu } from './git/GitRepoMenu';
import { getStatusErrorMessage, getUpstreamLabel } from './git/gitButtonViewModels';
import { useGitBranchActions } from './git/useGitBranchActions';
import { useGitRemoteActions } from './git/useGitRemoteActions';
import { useGitStashActions } from './git/useGitStashActions';
import type {
  DiffMode,
  GitBranch,
  GitDiffResult,
  GitHistoryEntry,
  GitOperationState,
  GitRemote,
  GitStash,
  GitStatus,
} from './git/types';
import type { PullRequestContext, DeepLink, ProviderContext } from '../store/vcsStore';
import { Dialog } from './ui/Dialog';
import { ManagementShell } from './ui/ManagementShell';
import { gitManagementScope } from './git/gitManagementScope';
import './GitButton.css';

interface GitButtonProps {
  workspacePath: string;
  workspaceId?: string;
}

export default function GitButton(props: GitButtonProps) {
  const workspace = useWorkspaceStore((state) => state.workspaces.find((entry) => entry.id === props.workspaceId));
  useAgentLocation(workspace?.activeTerminalId);
  useWorkspaceStore((state) => state.activeWorkspaceId);
  const scope = gitManagementScope(props.workspacePath, props.workspaceId);
  const trigger = useRef<HTMLButtonElement>(null);
  return scope.blocked ? <UnavailableGit key={scope.key} scope={scope} trigger={trigger} /> : <GitController key={scope.key} {...props} scope={scope} trigger={trigger} />;
}

function UnavailableGit({ scope, trigger }: { scope: ReturnType<typeof gitManagementScope>; trigger: React.RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false);
  return <><Button ref={trigger} size="xs" variant="ghost" aria-label="Source Control" onClick={() => setOpen(true)}><GitBranchIcon size={14} /></Button>
    <Dialog open={open} onOpenChange={setOpen}><ManagementShell onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }} title="Source Control" items={[{ id: 'overview', label: 'Overview', group: 'Repository' }]} selectedId="overview" onSelect={() => {}}>
      <p>{scope.environmentId === 'local' ? 'Local' : `SSH · ${scope.environmentId}`} · {scope.path}</p><p role="alert">{scope.blocked}</p>
    </ManagementShell></Dialog></>;
}

function GitController({ workspacePath, workspaceId, scope, trigger }: GitButtonProps & { scope: ReturnType<typeof gitManagementScope>; trigger: React.RefObject<HTMLButtonElement | null> }) {
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const isCurrent = useCallback(() => live.current && gitManagementScope(workspacePath, workspaceId).key === scope.key, [workspacePath, workspaceId, scope.key]);
  const [statusKnown, setStatusKnown] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const [isRepo, setIsRepo] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [changes, setChanges] = useState<GitStatus[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [isDetached, setIsDetached] = useState(false);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [operationState, setOperationState] = useState<GitOperationState | null>(null);
  const [isLoadingOperation, setIsLoadingOperation] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeTargetBranch, setMergeTargetBranch] = useState('');
  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [isLoadingStashes, setIsLoadingStashes] = useState(false);
  const [history, setHistory] = useState<GitHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedDiffMode, setSelectedDiffMode] = useState<DiffMode>('working');
  const [selectedDiffRef, setSelectedDiffRef] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<GitDiffResult | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [statusErrorCode, setStatusErrorCode] = useState<string | null>(null);
  const [upstream, setUpstream] = useState<string | null>(null);
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [provider, setProvider] = useState<'github' | 'bitbucket' | 'gitlab' | 'unknown'>('unknown');
  const [vcsProviderContext, setVcsProviderContext] = useState<ProviderContext | null>(null);
  const [pullRequest, setPullRequest] = useState<PullRequestContext | null>(null);
  const [deepLinks, setDeepLinks] = useState<DeepLink[]>([]);
  const [isLoadingVcsContext, setIsLoadingVcsContext] = useState(false);
  const [vcsContextError, setVcsContextError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [selectedDefaultBranch, setSelectedDefaultBranch] = useState('main');
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const createBranchInputRef = useRef<HTMLInputElement>(null);

  const { activeWorkspaceId } = useWorkspaceStore();
  const focusedWorkspace = useWorkspaceStore((state) => state.workspaces.find((entry) => entry.id === workspaceId));
  const agentLocation = useAgentLocation(focusedWorkspace?.activeTerminalId);
  const checkoutContextId = focusedWorkspace ? selectedVcsCheckoutId(focusedWorkspace, agentLocation) : undefined;
  const vcsGeneration = useRef(0);
  const invalidateVcsRequest = useCallback(() => { vcsGeneration.current++; }, []);
  useEffect(() => {
    invalidateVcsRequest();
    useVcsStore.getState().setContextSnapshot(null);
    setVcsProviderContext(null); setPullRequest(null); setDeepLinks([]);
    setVcsContextError(null); setIsLoadingVcsContext(false);
    return () => {
      invalidateVcsRequest();
      if (useVcsStore.getState().contextSnapshot?.identity?.workspaceId === workspaceId)
        useVcsStore.getState().setContextSnapshot(null);
    };
  }, [workspacePath, workspaceId, checkoutContextId, activeWorkspaceId, invalidateVcsRequest]);

  const currentBranchLabel = useMemo(() => {
    if (isDetached) return currentBranch ? `Detached HEAD · ${currentBranch}` : 'Detached HEAD';
    if (currentBranch) return currentBranch;
    return 'No branch selected';
  }, [currentBranch, isDetached]);

  const availableMergeTargets = useMemo(
    () => branches.filter((branch) => !branch.isCurrent).map((branch) => branch.name),
    [branches]
  );

  const statusErrorMessage = useMemo(
    () => getStatusErrorMessage(statusErrorCode),
    [statusErrorCode]
  );

  const upstreamLabel = useMemo(
    () => getUpstreamLabel(upstream, ahead, behind),
    [upstream, ahead, behind]
  );

  const loadVcsContext = useCallback(async (refresh = false) => {
    if (!isCurrent()) return;
    const generation = ++vcsGeneration.current;
    const fresh = () => isCurrent() && generation === vcsGeneration.current && (!workspaceId
      || (useWorkspaceStore.getState().activeWorkspaceId === workspaceId && currentVcsCheckoutId(workspaceId) === checkoutContextId));
    if (!workspacePath || checkoutContextId === null) {
      setVcsProviderContext(null);
      setPullRequest(null);
      setDeepLinks([]);
      return;
    }

    setIsLoadingVcsContext(true);
    setVcsContextError(null);

    try {
      const options = checkoutContextId || refresh ? { checkoutContextId: checkoutContextId ?? undefined, refresh } : undefined;
      const result = options ? await window.electronAPI.vcsGetContext(workspacePath, workspaceId, options)
        : await window.electronAPI.vcsGetContext(workspacePath, workspaceId);
      if (!fresh()) return;
      useVcsStore.getState().setContextSnapshot(result);
      setVcsContextError(result.error ?? (result.success ? null : 'Provider context unavailable'));
      if (result.provider) {
        setVcsProviderContext(result.provider as ProviderContext);
        setPullRequest(result.pullRequest as PullRequestContext | null);
        setDeepLinks(result.deepLinks ?? []);
      } else {
        setVcsProviderContext(null);
        setPullRequest(null);
        setDeepLinks([]);
      }
    } catch {
      if (fresh()) {
        setVcsContextError('Failed to load provider context');
        setVcsProviderContext(null); setPullRequest(null); setDeepLinks([]);
        useVcsStore.getState().setContextSnapshot(null);
      }
    } finally {
      if (fresh()) setIsLoadingVcsContext(false);
    }
  }, [workspacePath, workspaceId, checkoutContextId, isCurrent]);

  const loadRemotes = useCallback(async () => {
    if (!workspacePath || !isCurrent()) {
      return;
    }

    try {
      const remotesResult = await window.electronAPI.gitGetRemotes(workspacePath, workspaceId);
      if (!isCurrent()) return;
      if (remotesResult.success) {
        setRemotes(remotesResult.remotes);
        setProvider(remotesResult.provider);
      } else {
        setRemotes([]); setProvider('unknown');
      }
    } catch {
      if (isCurrent()) { setRemotes([]); setProvider('unknown'); }
    }
  }, [workspacePath, workspaceId, isCurrent]);

  useEffect(() => {
    if (!workspacePath) {
      setRemotes([]);
      return;
    }

    void loadRemotes();
  }, [workspacePath, loadRemotes]);

  const refreshMenuDataRef = useRef<() => Promise<void>>(async () => {});
  const [menuRefreshCount, setMenuRefreshCount] = useState(0);

  const refreshAfterAction = useCallback(async () => {
    if (!isCurrent()) return;
    await Promise.all([refreshMenuDataRef.current(), window.electronAPI.gitRefresh(workspaceId)]);
  }, [workspaceId, isCurrent]);

  const {
    branchError,
    closeDeleteDialog,
    deleteDialog,
    handleCreateBranch,
    handleDeleteBranch,
    handleSwitchBranch,
    newBranchName,
    performDeleteBranch,
    setBranchError,
    setNewBranchName,
  } = useGitBranchActions({
    activeAction,
    currentBranch,
    onSetActiveAction: setActiveAction,
    refreshAfterAction,
    workspacePath,
    workspaceId,
  });

  const {
    handleFetch,
    handlePublish,
    handlePull,
    handlePush,
    remoteAction,
    remoteError,
    setRemoteError,
  } = useGitRemoteActions({
    currentBranch,
    loadRemotes,
    refreshAfterAction,
    remotes,
    workspacePath,
    workspaceId,
  });

  const {
    handleApplyStash,
    handleClearStashes,
    handleDropStash,
    handlePopStash,
    handleStash,
    includeUntracked,
    setIncludeUntracked,
    setStashError,
    setStashMessage,
    stashError,
    stashMessage,
  } = useGitStashActions({
    onSetActiveAction: setActiveAction,
    refreshAfterAction,
    workspacePath,
    workspaceId,
  });

  const dataRequest = useRef(0);
  const refreshMenuData = useCallback(async () => {
    const request = ++dataRequest.current;
    const fresh = () => isCurrent() && request === dataRequest.current;
    if (!workspacePath || !fresh()) {
      return;
    }

    setMenuRefreshCount((count) => count + 1);

    setIsLoadingBranches(true);
    setIsLoadingOperation(true);
    setIsLoadingStashes(true);
    setIsLoadingHistory(true);
    setIsLoadingDiff(true);
    setBranchError(null);
    setMergeError(null);
    setStashError(null);
    setHistoryError(null);
    setDiffError(null);

    try {
      const [branchState, opState, stashItems, historyItems] = await Promise.all([
        window.electronAPI.gitGetBranchState(workspacePath, workspaceId),
        window.electronAPI.gitGetOperationState(workspacePath, workspaceId),
        window.electronAPI.gitGetStashes(workspacePath, workspaceId),
        window.electronAPI.gitGetHistory(workspacePath, 8, workspaceId),
      ]);

      if (!fresh()) return;
      if (branchState.success) {
        const sortedBranches = [...branchState.branches].sort((a, b) => {
          if (a.isCurrent !== b.isCurrent) {
            return a.isCurrent ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

        setIsRepo(branchState.isRepo);
        setCurrentBranch(branchState.currentBranch);
        setIsDetached(branchState.isDetached);
        setBranches(sortedBranches);

        const availableTargets = sortedBranches.filter((branch) => !branch.isCurrent);
        setMergeTargetBranch((previous) => {
          if (previous && availableTargets.some((branch) => branch.name === previous)) {
            return previous;
          }
          return availableTargets[0]?.name ?? '';
        });
      } else {
        setStatusKnown(false);
        setIsRepo(false);
        setCurrentBranch(null);
        setIsDetached(false);
        setBranches([]);
        setMergeTargetBranch('');
        setBranchError(branchState.error || 'Unable to load branch state');
        setDiffResult(null);
        setDiffError(null);
      }

      if (opState.success) {
        setOperationState(opState);
      } else {
        setOperationState({
          success: false,
          isRepo: false,
          inProgress: false,
          mode: 'none',
          conflicts: [],
          message: opState.error || 'Unable to load merge state',
          error: opState.error,
        });
      }

      setStashes(stashItems);
      setHistory(historyItems);

      const diffRef = selectedDiffMode === 'commit'
        ? selectedDiffRef ?? historyItems[0]?.hash
        : undefined;
      if (selectedDiffMode === 'commit' && diffRef && !selectedDiffRef) {
        setSelectedDiffRef(diffRef);
      }

      const diff = await window.electronAPI.gitGetDiff(workspacePath, selectedDiffMode, diffRef, workspaceId);
      if (!fresh()) return;
      setDiffResult(diff);
      if (!diff.success) {
        setDiffError(diff.error || 'Unable to load diff');
      }

      const remotesResult = await window.electronAPI.gitGetRemotes(workspacePath, workspaceId);
      if (!fresh()) return;
      if (remotesResult.success) {
        setProvider(remotesResult.provider);
        setRemotes(remotesResult.remotes);
      } else {
        setRemotes([]); setProvider('unknown');
      }

      await loadVcsContext();
    } catch (error: unknown) {
      if (!fresh()) return;
      const message = error instanceof Error ? error.message : 'Unable to load git data';
      setOperationState(null);
      setBranchError(message);
      setMergeError(message);
      setStashError(message);
      setHistoryError(message);
      setDiffError(message);
    } finally {
      if (fresh()) {
      setIsLoadingBranches(false);
      setIsLoadingOperation(false);
      setIsLoadingStashes(false);
      setIsLoadingHistory(false);
      setIsLoadingDiff(false);
      }
    }
  }, [selectedDiffMode, selectedDiffRef, workspacePath, workspaceId, loadVcsContext, setBranchError, setStashError, isCurrent]);

  refreshMenuDataRef.current = refreshMenuData;

  const diffRequest = useRef(0);
  const loadDiff = async (mode: DiffMode, ref?: string) => {
    const request = ++diffRequest.current;
    const fresh = () => isCurrent() && request === diffRequest.current;
    if (!workspacePath || !fresh()) {
      return;
    }

    setSelectedDiffMode(mode);
    setSelectedDiffRef(mode === 'commit' ? ref ?? null : null);
    setIsLoadingDiff(true);
    setDiffError(null);

    try {
      const diff = await window.electronAPI.gitGetDiff(workspacePath, mode, ref, workspaceId);
      if (!fresh()) return;
      setDiffResult(diff);
      if (!diff.success) {
        setDiffError(diff.error || 'Unable to load diff');
      }
    } catch (error: unknown) {
      if (fresh()) setDiffError(error instanceof Error ? error.message : 'Unable to load diff');
    } finally {
      if (fresh()) setIsLoadingDiff(false);
    }
  };

  useEffect(() => {
    if (!workspacePath) {
      setChangeCount(0);
      setIsRepo(false);
      setChanges([]);
      useWorkspaceStore.getState().setGitChanges([]);
      useWorkspaceStore.getState().setGitBranchInfo(null, false, false);
      setCurrentBranch(null);
      setIsDetached(false);
      setStatusErrorCode(null);
      setUpstream(null);
      setAhead(0);
      setBehind(0);
      setProvider('unknown');
      setBranches([]);
      setOperationState(null);
      setStashes([]);
      setHistory([]);
      setIsMenuOpen(false);
      setIsDialogOpen(false);
      return;
    }

    window.electronAPI.gitStartPolling(workspacePath, workspaceId);

    return () => {
      void window.electronAPI.gitStopPolling(workspaceId).catch((error: unknown) => {
        if (error instanceof Error && error.message.includes('Workspace identity is no longer registered')) return;
        console.error('Failed to stop Git polling:', error);
      });
    };
  }, [workspacePath, workspaceId]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onGitStatusUpdate((status) => {
      if (!isCurrent()) return;
      const activeWs = useWorkspaceStore.getState().getActiveWorkspace();
      if (activeWs) {
        if (workspaceId
          ? activeWs.id !== workspaceId || status.workspaceId !== workspaceId
          : status.workspaceId && status.workspaceId !== activeWs.id) {
          return;
        }
        if (status.environmentId && status.environmentId !== (activeWs.environmentId || 'local')) {
          return;
        }
        if (status.workspacePath && !sameWorkspacePath(status.workspacePath, activeWs.workspacePath)) {
          return;
        }
      } else if (workspacePath && status.workspacePath && !sameWorkspacePath(status.workspacePath, workspacePath)) {
        return;
      }
      setStatusKnown(status.success);
      if (status.success) {
        setIsRepo(status.isRepo);
        setChangeCount(status.changes.length);
        setChanges(status.changes);
        setCurrentBranch(status.currentBranch);
        setIsDetached(status.isDetached);
        setStatusErrorCode(null);
        setUpstream(status.upstream);
        setAhead(status.ahead);
        setBehind(status.behind);

        useWorkspaceStore.getState().setGitChanges(status.isRepo ? status.changes : []);
        useWorkspaceStore.getState().setGitBranchInfo(status.currentBranch, status.isRepo, status.isDetached);
      } else {
        setIsRepo(false);
        setChangeCount(0);
        setChanges([]);
        setCurrentBranch(null);
        setIsDetached(false);
        setStatusErrorCode(status.errorCode ?? null);
        setUpstream(null);
        setAhead(0);
        setBehind(0);
        setProvider('unknown');
        useWorkspaceStore.getState().setGitChanges([]);
        useWorkspaceStore.getState().setGitBranchInfo(null, false, false);
      }
    });

    return unsubscribe;
  }, [workspacePath, workspaceId, isCurrent]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    if (!isRepo) {
      return;
    }

    void refreshMenuData();
  }, [isMenuOpen, isRepo, refreshMenuData]);

  const handleCommit = async (message: string) => isCurrent() ? window.electronAPI.gitCommit(workspacePath, message, workspaceId) : { success: false, error: 'Repository scope changed' };

  const handleStage = async () => isCurrent() ? window.electronAPI.gitStage(workspacePath, undefined, workspaceId) : { success: false, error: 'Repository scope changed' };

  const handleUnstageFile = async (path: string): Promise<{ success: boolean; error?: string }> => {
    if (!isCurrent()) return { success: false, error: 'Repository scope changed' };
    const result = await window.electronAPI.gitUnstage(workspacePath, [path], workspaceId);
    if (result.success && isCurrent()) {
      const status = await window.electronAPI.gitRefresh(workspaceId);
      if (status?.success && isCurrent()) { setChanges(status.changes); setChangeCount(status.changes.length); }
    }
    return result;
  };

  const handleUnstageAll = async (): Promise<{ success: boolean; error?: string }> => {
    if (!isCurrent()) return { success: false, error: 'Repository scope changed' };
    const result = await window.electronAPI.gitUnstage(workspacePath, undefined, workspaceId);
    if (result.success && isCurrent()) {
      const status = await window.electronAPI.gitRefresh(workspaceId);
      if (status?.success && isCurrent()) { setChanges(status.changes); setChangeCount(status.changes.length); }
    }
    return result;
  };

  const handleInitRepository = async () => {
    if (!isCurrent() || !statusKnown || isInitializing) return;
    setIsInitializing(true);
    setInitError(null);

    try {
      const result = await window.electronAPI.gitInit(workspacePath, selectedDefaultBranch, workspaceId);
      if (!isCurrent()) return;
      if (result.success) {
        await window.electronAPI.gitRefresh(workspaceId);
        setIsMenuOpen(false);
      } else {
        setInitError(result.error || 'Failed to initialize repository');
      }
    } catch (error: unknown) {
      setInitError(error instanceof Error ? error.message : 'Failed to initialize repository');
    } finally {
      setIsInitializing(false);
    }
  };

  const handleOpenCommitDialog = async () => {
    if (!isCurrent() || activeAction) return;
    setActiveAction('open-commit');
    try {
      const status = await window.electronAPI.gitRefresh(workspaceId);
      if (!isCurrent()) return;
      if (!status?.success) { setRemoteError('Could not refresh changes before opening Commit'); return; }
      setChanges(status.changes); setChangeCount(status.changes.length);
      setCurrentBranch(status.currentBranch); setIsDetached(status.isDetached);
      setIsDialogOpen(true);
    } catch (error) { if (isCurrent()) setRemoteError(error instanceof Error ? error.message : 'Could not refresh changes'); }
    finally { if (isCurrent()) setActiveAction(null); }
  };

  const handleToggleMenu = () => {
    if (!workspacePath || !isCurrent()) {
      return;
    }

    setIsMenuOpen((value) => !value);
  };

  const handleMergeBranch = async () => {
    if (!isCurrent()) return;
    if (!mergeTargetBranch) {
      setMergeError('Select a branch to merge');
      return;
    }

    setActiveAction(`merge:${mergeTargetBranch}`);
    setMergeError(null);

    try {
      const result = await window.electronAPI.gitMergeBranch(workspacePath, mergeTargetBranch, workspaceId);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setMergeError(result.error || 'Failed to merge branch');
      }
    } catch (error: unknown) {
      setMergeError(error instanceof Error ? error.message : 'Failed to merge branch');
    } finally {
      setActiveAction(null);
    }
  };

  const handleAbortOperation = async () => {
    if (!isCurrent()) return;
    setActiveAction('abort-operation');
    setMergeError(null);

    try {
      const result = await window.electronAPI.gitAbortOperation(workspacePath, workspaceId);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setMergeError(result.error || 'Failed to abort operation');
      }
    } catch (error: unknown) {
      setMergeError(error instanceof Error ? error.message : 'Failed to abort operation');
    } finally {
      setActiveAction(null);
    }
  };

  const handleSelectWorkingDiff = async (mode: DiffMode) => {
    await loadDiff(mode, mode === 'commit' ? selectedDiffRef ?? history[0]?.hash : undefined);
  };

  const handleSelectCommitDiff = async (commit: GitHistoryEntry) => {
    await loadDiff('commit', commit.hash);
  };

  const isBusy = activeAction !== null || remoteAction !== null;
  const selectedCommit = selectedDiffMode === 'commit'
    ? history.find((entry) => entry.hash === selectedDiffRef) ?? null
    : null;
  const deleteDialogBusy = Boolean(
    deleteDialog &&
      (activeAction === `delete:${deleteDialog.branch}` ||
        activeAction === `force-delete:${deleteDialog.branch}`)
  );

  return (
    <>
      <div className="git-menu-container">
        <Button
          ref={trigger}
          aria-label="Source Control"
          size="xs"
          variant="ghost"
          className={`header-btn toolbar-btn git-btn ${isMenuOpen ? 'active' : ''}`}
          onClick={handleToggleMenu}
          aria-expanded={isMenuOpen}
          title={!isRepo ? 'Initialize Git Repository' : currentBranch ? `Git - ${currentBranch}` : 'Git - View changes and branches'}
        >
          <GitBranchIcon size={14} strokeWidth={2} />
          {!isRepo && <span>Init Git</span>}
          {changeCount > 0 && (
            <span className="git-badge">{changeCount > 99 ? '99+' : changeCount}</span>
          )}
          <ChevronDown size={12} strokeWidth={2.5} />
        </Button>

        <Dialog open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        {isRepo ? <GitRepoMenu
            scope={scope}
            statusKnown={statusKnown}
            activeAction={activeAction}
            ahead={ahead}
            availableMergeTargets={availableMergeTargets}
            behind={behind}
            branchError={branchError}
            branches={branches}
            changeCount={changeCount}
            createBranchInputRef={createBranchInputRef}
            currentBranch={currentBranch}
            currentBranchLabel={currentBranchLabel}
            deepLinks={deepLinks}
            diffError={diffError}
            diffResult={diffResult}
            history={history}
            historyError={historyError}
            includeUntracked={includeUntracked}
            isBusy={isBusy}
            isDetached={isDetached}
            isLoadingBranches={isLoadingBranches}
            isLoadingContext={isLoadingVcsContext}
            isLoadingDiff={isLoadingDiff}
            isLoadingHistory={isLoadingHistory}
            isLoadingOperation={isLoadingOperation}
            isLoadingStashes={isLoadingStashes}
            mergeError={mergeError}
            mergeTargetBranch={mergeTargetBranch}
            newBranchName={newBranchName}
            onAbortOperation={() => void handleAbortOperation()}
            onApplyStash={(stashRef) => { if (isCurrent()) void handleApplyStash(stashRef); }}
            onClearStashes={() => { if (isCurrent()) void handleClearStashes(); }}
            onRestoreFocus={() => trigger.current?.focus()}
            onCreateBranch={(event) => { if (isCurrent()) void handleCreateBranch(event); }}
            onDeleteBranch={(branchName) => { if (isCurrent()) handleDeleteBranch(branchName); }}
            onDropStash={(stashRef) => { if (isCurrent()) void handleDropStash(stashRef); }}
            onFetch={() => { if (isCurrent()) void handleFetch(); }}
            onMergeBranch={() => void handleMergeBranch()}
            onOpenCommitDialog={() => void handleOpenCommitDialog()}
            onPopStash={(stashRef) => { if (isCurrent()) void handlePopStash(stashRef); }}
            onPublish={() => { if (isCurrent()) void handlePublish(); }}
            onPull={() => { if (isCurrent()) void handlePull(); }}
            onPush={() => { if (isCurrent()) void handlePush(); }}
            onRefresh={() => { void refreshAfterAction().catch((error: unknown) => { if (isCurrent()) setRemoteError(error instanceof Error ? error.message : 'Refresh failed'); }); }}
            onRefreshContext={() => void loadVcsContext(true)}
            onRemotesChanged={() => void loadRemotes()}
            onSelectCommitDiff={(commit) => void handleSelectCommitDiff(commit)}
            onSelectWorkingDiff={(mode) => void handleSelectWorkingDiff(mode)}
            onSetIncludeUntracked={setIncludeUntracked}
            onSetMergeTargetBranch={setMergeTargetBranch}
            onSetNewBranchName={setNewBranchName}
            onSetRemoteError={setRemoteError}
            onSetStashMessage={setStashMessage}
            onStash={() => { if (isCurrent()) void handleStash(); }}
            onSwitchBranch={(branchName) => { if (isCurrent()) void handleSwitchBranch(branchName); }}
            operationState={operationState}
            provider={provider}
            providerContext={vcsProviderContext}
            pullRequest={pullRequest}
            refreshKey={menuRefreshCount}
            remoteAction={remoteAction}
            remoteError={remoteError}
            remotes={remotes}
            selectedCommit={selectedCommit}
            selectedDiffMode={selectedDiffMode}
            selectedDiffRef={selectedDiffRef}
            stashError={stashError}
            stashMessage={stashMessage}
            stashes={stashes}
            statusErrorMessage={statusErrorMessage}
            upstream={upstream}
            upstreamLabel={upstreamLabel}
            vcsContextError={vcsContextError}
            workspacePath={workspacePath}
            workspaceId={workspaceId}
          /> : <ManagementShell onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }} title="Source Control" items={[{ id: 'overview', label: 'Overview', group: 'Repository' }]} selectedId="overview" onSelect={() => {}}>
            <p>{scope.environmentId === 'local' ? 'Local' : `SSH · ${scope.environmentId}`} · {scope.path}</p>
            <GitInitMenu initError={initError} isInitializing={isInitializing} onInitialize={() => void handleInitRepository()} onSelectDefaultBranch={setSelectedDefaultBranch} selectedDefaultBranch={selectedDefaultBranch} statusErrorMessage={statusErrorMessage} statusKnown={statusKnown} />
          </ManagementShell>}
        </Dialog>
      </div>

      <CommitDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onCommit={handleCommit}
        onStageAll={handleStage}
        onUnstage={handleUnstageFile}
        onUnstageAll={handleUnstageAll}
        changes={changes}
        workspacePath={workspacePath}
        workspaceId={workspaceId}
      />

      {deleteDialog && (
        <GitDeleteBranchDialog
          currentBranch={currentBranch}
          deleteDialog={deleteDialog}
          isBusy={deleteDialogBusy}
          onCancel={closeDeleteDialog}
          onConfirmDelete={(forceDelete) => { if (isCurrent()) void performDeleteBranch(forceDelete); }}
        />
      )}
    </>
  );
}
