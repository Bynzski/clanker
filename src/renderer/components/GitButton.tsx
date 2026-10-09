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
import { useKeepInViewport } from '../lib/useKeepInViewport';
import './GitButton.css';

interface GitButtonProps {
  workspacePath: string;
  workspaceId?: string;
}

export default function GitButton({ workspacePath, workspaceId }: GitButtonProps) {
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
  const menuRef = useRef<HTMLDivElement>(null);
  // Modals owned by menu content render in portals outside `menuRef`; while one is open, outside
  // pointer/Escape closing is suspended so the menu (and the modal's owner) outlives its action.
  const menuModalCountRef = useRef(0);
  const handleMenuModalChange = useCallback((open: boolean) => {
    menuModalCountRef.current = Math.max(0, menuModalCountRef.current + (open ? 1 : -1));
  }, []);
  useKeepInViewport(menuRef, '.git-menu', isMenuOpen, isRepo);
  const createBranchInputRef = useRef<HTMLInputElement>(null);

  const { activeWorkspaceId, pushBrowserOverlay, popBrowserOverlay } = useWorkspaceStore();
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

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    if (!activeWorkspaceId) {
      return;
    }

    pushBrowserOverlay(activeWorkspaceId);
    return () => popBrowserOverlay(activeWorkspaceId);
  }, [activeWorkspaceId, isMenuOpen, pushBrowserOverlay, popBrowserOverlay]);

  const currentBranchLabel = useMemo(() => {
    if (currentBranch) {
      return currentBranch;
    }
    if (isDetached) {
      return 'Detached HEAD';
    }
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
    const generation = ++vcsGeneration.current;
    const fresh = () => generation === vcsGeneration.current && (!workspaceId
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
      setVcsContextError(result.error ?? null);
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
      if (fresh()) setVcsContextError('Failed to load provider context');
    } finally {
      if (fresh()) setIsLoadingVcsContext(false);
    }
  }, [workspacePath, workspaceId, checkoutContextId]);

  const loadRemotes = useCallback(async () => {
    if (!workspacePath) {
      return;
    }

    try {
      const remotesResult = await window.electronAPI.gitGetRemotes(workspacePath, workspaceId);
      if (remotesResult.success) {
        setRemotes(remotesResult.remotes);
        setProvider(remotesResult.provider);
      } else {
        setRemotes([]);
      }
    } catch {
      setRemotes([]);
    }
  }, [workspacePath, workspaceId]);

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
    await Promise.all([refreshMenuDataRef.current(), window.electronAPI.gitRefresh(workspaceId)]);
  }, [workspaceId]);

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

  const refreshMenuData = useCallback(async () => {
    if (!workspacePath) {
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
      setDiffResult(diff);
      if (!diff.success) {
        setDiffError(diff.error || 'Unable to load diff');
      }

      const remotesResult = await window.electronAPI.gitGetRemotes(workspacePath, workspaceId);
      if (remotesResult.success) {
        setProvider(remotesResult.provider);
        setRemotes(remotesResult.remotes);
      } else {
        setRemotes([]);
      }

      await loadVcsContext();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to load git data';
      setBranchError(message);
      setMergeError(message);
      setStashError(message);
      setHistoryError(message);
      setDiffError(message);
    } finally {
      setIsLoadingBranches(false);
      setIsLoadingOperation(false);
      setIsLoadingStashes(false);
      setIsLoadingHistory(false);
      setIsLoadingDiff(false);
    }
  }, [selectedDiffMode, selectedDiffRef, workspacePath, workspaceId, loadVcsContext, setBranchError, setStashError]);

  refreshMenuDataRef.current = refreshMenuData;

  const loadDiff = async (mode: DiffMode, ref?: string) => {
    if (!workspacePath) {
      return;
    }

    setSelectedDiffMode(mode);
    setSelectedDiffRef(mode === 'commit' ? ref ?? null : null);
    setIsLoadingDiff(true);
    setDiffError(null);

    try {
      const diff = await window.electronAPI.gitGetDiff(workspacePath, mode, ref, workspaceId);
      setDiffResult(diff);
      if (!diff.success) {
        setDiffError(diff.error || 'Unable to load diff');
      }
    } catch (error: unknown) {
      setDiffError(error instanceof Error ? error.message : 'Unable to load diff');
    } finally {
      setIsLoadingDiff(false);
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

    void (async () => {
      try {
        const result = await window.electronAPI.gitGetRemotes(workspacePath, workspaceId);
        if (result.success) {
          setProvider(result.provider);
        }
      } catch {
        return;
      }
    })();

    return () => {
      void window.electronAPI.gitStopPolling(workspaceId).catch((error: unknown) => {
        if (error instanceof Error && error.message.includes('Workspace identity is no longer registered')) return;
        console.error('Failed to stop Git polling:', error);
      });
    };
  }, [workspacePath, workspaceId]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onGitStatusUpdate((status) => {
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
  }, [workspacePath, workspaceId]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    if (!isRepo) {
      return;
    }

    window.setTimeout(() => createBranchInputRef.current?.focus(), 50);
    void refreshMenuData();

    const handlePointerDown = (event: MouseEvent) => {
      if (menuModalCountRef.current > 0) return;
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menuModalCountRef.current === 0) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isMenuOpen, isRepo, refreshMenuData]);

  const handleCommit = async (message: string) => window.electronAPI.gitCommit(workspacePath, message, workspaceId);

  const handleStage = async () => window.electronAPI.gitStage(workspacePath, undefined, workspaceId);

  const handleUnstageFile = async (path: string): Promise<{ success: boolean; error?: string }> => {
    const result = await window.electronAPI.gitUnstage(workspacePath, [path], workspaceId);
    if (result.success) {
      const status = await window.electronAPI.gitRefresh(workspaceId);
      if (status) {
        setChanges(status.changes);
        setChangeCount(status.changes.length);
      }
    }
    return result;
  };

  const handleUnstageAll = async (): Promise<{ success: boolean; error?: string }> => {
    const result = await window.electronAPI.gitUnstage(workspacePath, undefined, workspaceId);
    if (result.success) {
      const status = await window.electronAPI.gitRefresh(workspaceId);
      if (status) {
        setChanges(status.changes);
        setChangeCount(status.changes.length);
      }
    }
    return result;
  };

  const handleInitRepository = async () => {
    setIsInitializing(true);
    setInitError(null);

    try {
      const result = await window.electronAPI.gitInit(workspacePath, selectedDefaultBranch, workspaceId);
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
    const status = await window.electronAPI.gitRefresh(workspaceId);
    if (status) {
      setChanges(status.changes);
      setChangeCount(status.changes.length);
      setCurrentBranch(status.currentBranch);
      setIsDetached(status.isDetached);
    }
    setIsMenuOpen(false);
    setIsDialogOpen(true);
  };

  const handleToggleMenu = () => {
    if (!workspacePath) {
      return;
    }

    setIsMenuOpen((value) => !value);
  };

  const handleMergeBranch = async () => {
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

  if (!isRepo) {
    return (
      <div className="git-menu-container" ref={menuRef}>
        <GitInitMenu
          initError={initError}
          isInitializing={isInitializing}
          isMenuOpen={isMenuOpen}
          onClose={() => setIsMenuOpen(false)}
          onInitialize={() => void handleInitRepository()}
          onSelectDefaultBranch={setSelectedDefaultBranch}
          onToggleMenu={() => setIsMenuOpen((value) => !value)}
          selectedDefaultBranch={selectedDefaultBranch}
          statusErrorMessage={statusErrorMessage}
        />
      </div>
    );
  }

  const isBusy = activeAction !== null;
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
      <div className="git-menu-container" ref={menuRef}>
        <Button
          size="xs"
          variant="ghost"
          className={`header-btn toolbar-btn git-btn ${isMenuOpen ? 'active' : ''}`}
          onClick={handleToggleMenu}
          aria-expanded={isMenuOpen}
          title={currentBranch ? `Git - ${currentBranch}` : 'Git - View changes and branches'}
        >
          <GitBranchIcon size={14} strokeWidth={2} />
          {changeCount > 0 && (
            <span className="git-badge">{changeCount > 99 ? '99+' : changeCount}</span>
          )}
          <ChevronDown size={12} strokeWidth={2.5} />
        </Button>

        {isMenuOpen && (
          <GitRepoMenu
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
            onApplyStash={(stashRef) => void handleApplyStash(stashRef)}
            onClearStashes={() => void handleClearStashes()}
            onClose={() => setIsMenuOpen(false)}
            onModalOpenChange={handleMenuModalChange}
            onCreateBranch={handleCreateBranch}
            onDeleteBranch={(branchName) => void handleDeleteBranch(branchName)}
            onDropStash={(stashRef) => void handleDropStash(stashRef)}
            onFetch={() => void handleFetch()}
            onMergeBranch={() => void handleMergeBranch()}
            onOpenCommitDialog={() => void handleOpenCommitDialog()}
            onPopStash={(stashRef) => void handlePopStash(stashRef)}
            onPublish={() => void handlePublish()}
            onPull={() => void handlePull()}
            onPush={() => void handlePush()}
            onRefresh={() => void refreshMenuData()}
            onRefreshContext={() => void loadVcsContext(true)}
            onRemotesChanged={() => void loadRemotes()}
            onSelectCommitDiff={(commit) => void handleSelectCommitDiff(commit)}
            onSelectWorkingDiff={(mode) => void handleSelectWorkingDiff(mode)}
            onSetIncludeUntracked={setIncludeUntracked}
            onSetMergeTargetBranch={setMergeTargetBranch}
            onSetNewBranchName={setNewBranchName}
            onSetRemoteError={setRemoteError}
            onSetStashMessage={setStashMessage}
            onStash={() => void handleStash()}
            onSwitchBranch={(branchName) => void handleSwitchBranch(branchName)}
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
          />
        )}
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
          onConfirmDelete={(forceDelete) => void performDeleteBranch(forceDelete)}
        />
      )}
    </>
  );
}
