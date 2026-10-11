import { Button } from './ui/Button';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, GitBranch as GitBranchIcon } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useVcsStore } from '../store/vcsStore';
import { sameWorkspacePath } from '../lib/pathUtils';
import { selectedVcsCheckoutId, currentVcsCheckoutId } from '../lib/vcsCheckout';
import { useAgentLocation } from '../lib/useAgentLocation';
import { requestCheckoutReconciliation } from '../lib/checkoutReconciliation';
import { useCommitComposer } from './git/useCommitComposer';
import { GitAbortOperationDialog } from './git/GitAbortOperationDialog';
import { GitClearStashesDialog } from './git/GitClearStashesDialog';
import { GitDeleteBranchDialog } from './git/GitDeleteBranchDialog';
import { GitDropStashDialog } from './git/GitDropStashDialog';
import { GitInitMenu } from './git/GitInitMenu';
import { changedFileCount } from './git/gitChangePresentation';
import { GitRepoMenu } from './git/GitRepoMenu';
import { getStatusErrorMessage, getUpstreamLabel } from './git/gitButtonViewModels';
import { useGitBranchActions } from './git/useGitBranchActions';
import { useGitMergeActions } from './git/useGitMergeActions';
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
import type { GitStatusResult } from '../../shared/types/git';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [changes, setChanges] = useState<GitStatus[]>([]);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [isLoadingChanges, setIsLoadingChanges] = useState(false);
  const [reviewRevision, setReviewRevision] = useState(0);
  const changeMutationLock = useRef(false);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [isDetached, setIsDetached] = useState(false);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [operationState, setOperationState] = useState<GitOperationState | null>(null);
  const [isLoadingOperation, setIsLoadingOperation] = useState(false);
  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [isLoadingStashes, setIsLoadingStashes] = useState(false);
  const [history, setHistory] = useState<GitHistoryEntry[]>([]);
  const [historyLimit, setHistoryLimit] = useState(10);
  const historyLimitRef = useRef(10);
  const historyRequest = useRef(0);
  const historyLoadingRef = useRef(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedDiffMode, setSelectedDiffMode] = useState<DiffMode>('commit');
  const [selectedDiffRef, setSelectedDiffRef] = useState<string | null>(null);
  const diffSelectionRef = useRef<{ mode: DiffMode; ref: string | null }>({ mode: 'commit', ref: null });
  diffSelectionRef.current = { mode: selectedDiffMode, ref: selectedDiffRef };
  const [diffResult, setDiffResult] = useState<GitDiffResult | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const diffGeneration = useRef(0);
  const hasMoreHistory = history.length === historyLimit && historyLimit < 50;
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

  const refreshMenuDataRef = useRef<(reloadWorktrees?: boolean) => Promise<void>>(async () => {});
  const refreshChangesRef = useRef<() => Promise<void>>(async () => {});
  const [menuRefreshCount, setMenuRefreshCount] = useState(0);

  const refreshAfterAction = useCallback(async () => {
    if (!isCurrent()) return;
    await Promise.all([
      refreshMenuDataRef.current(),
      refreshChangesRef.current(),
    ]);
  }, [isCurrent]);

  const refreshAfterBranchAction = useCallback(async () => {
    if (!isCurrent()) return;
    await Promise.all([
      refreshAfterAction(),
      ...(workspaceId ? [requestCheckoutReconciliation(workspaceId)] : []),
    ]);
  }, [isCurrent, refreshAfterAction, workspaceId]);

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
    isCurrent,
    activeAction,
    currentBranch,
    onSetActiveAction: setActiveAction,
    refreshAfterAction: refreshAfterBranchAction,
    workspacePath: scope.path,
    workspaceId,
    checkoutContextId: scope.checkoutContextId,
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
    isCurrent,
    currentBranch,
    loadRemotes,
    refreshAfterAction,
    remotes,
    workspacePath,
    workspaceId,
    checkoutContextId: scope.checkoutContextId,
  });

  const {
    clearDialog,
    closeClearDialog,
    closeDropDialog,
    dropDialog,
    handleApplyStash,
    handleClearStashes,
    handleDropStash,
    handlePopStash,
    handleStash,
    includeUntracked,
    performClearStashes,
    performDropStash,
    setIncludeUntracked,
    setStashError,
    setStashMessage,
    stashError,
    stashMessage,
  } = useGitStashActions({
    isCurrent,
    activeAction,
    onSetActiveAction: setActiveAction,
    refreshAfterAction,
    stashes,
    workspacePath: scope.path,
    workspaceId,
    checkoutContextId: scope.checkoutContextId,
  });

  const {
    abortDialog,
    closeAbortDialog,
    handleMergeBranch,
    handleRequestAbort,
    mergeError,
    mergeTargetBranch,
    performAbortOperation,
    setMergeError,
    setMergeTargetBranch,
  } = useGitMergeActions({
    isCurrent,
    activeAction,
    onSetActiveAction: setActiveAction,
    refreshAfterAction,
    workspacePath: scope.path,
    workspaceId,
    checkoutContextId: scope.checkoutContextId,
    operationState,
  });

  const fetchDiff = useCallback(async (mode: DiffMode, ref: string | null) => {
    if (!workspacePath || !isCurrent()) {
      return;
    }
    const generation = ++diffGeneration.current;
    const fresh = () => isCurrent() && generation === diffGeneration.current;

    setDiffResult(null);
    setIsLoadingDiff(true);
    setDiffError(null);

    try {
      const commitRef = mode === 'commit' ? ref ?? undefined : undefined;
      const result = await window.electronAPI.gitGetDiff(scope.path, mode, commitRef, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));
      if (!fresh()) return;
      setDiffResult(result.success ? result : null);
      if (!result.success) {
        setDiffError(result.error || 'Unable to load summary');
      } else {
        setDiffError(null);
      }
    } catch (error: unknown) {
      if (fresh()) {
        setDiffResult(null);
        setDiffError(error instanceof Error ? error.message : 'Unable to load summary');
      }
    } finally {
      if (fresh()) {
        setIsLoadingDiff(false);
      }
    }
  }, [scope.path, workspacePath, workspaceId, scope.checkoutContextId, isCurrent]);

  const handleSelectWorkingDiff = useCallback((mode: DiffMode) => {
    if (!isCurrent()) return;
    diffSelectionRef.current = { mode, ref: null };
    setSelectedDiffMode(mode);
    setSelectedDiffRef(null);
    void fetchDiff(mode, null);
  }, [isCurrent, fetchDiff]);

  const handleSelectCommitDiff = useCallback((commit: GitHistoryEntry) => {
    if (!isCurrent()) return;
    diffSelectionRef.current = { mode: 'commit', ref: commit.hash };
    setSelectedDiffMode('commit');
    setSelectedDiffRef(commit.hash);
    void fetchDiff('commit', commit.hash);
  }, [isCurrent, fetchDiff]);

  const handleLoadMoreHistory = useCallback(async () => {
    if (!isCurrent() || historyLoadingRef.current || !hasMoreHistory) return;
    const request = ++historyRequest.current;
    const fresh = () => isCurrent() && request === historyRequest.current;
    const nextLimit = Math.min(50, historyLimitRef.current + 15);
    historyLoadingRef.current = true;
    setIsLoadingHistory(true);
    setHistoryError(null);

    try {
      const items = await window.electronAPI.gitGetHistory(scope.path, nextLimit, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));
      if (!fresh()) return;
      historyLimitRef.current = nextLimit;
      setHistoryLimit(nextLimit);
      setHistory(items);
    } catch (error: unknown) {
      if (fresh()) {
        setHistoryError(error instanceof Error ? error.message : 'Unable to load history');
      }
    } finally {
      if (fresh()) {
        historyLoadingRef.current = false;
        setIsLoadingHistory(false);
      }
    }
  }, [isCurrent, hasMoreHistory, workspaceId, scope.path, scope.checkoutContextId]);

  const dataRequest = useRef(0);
  const refreshMenuData = useCallback(async (reloadWorktrees = true) => {
    const request = ++dataRequest.current;
    const startDiffGen = diffGeneration.current;
    const fresh = () => isCurrent() && request === dataRequest.current;
    if (!workspacePath || !fresh()) {
      return;
    }

    const historyGeneration = ++historyRequest.current;
    historyLoadingRef.current = true;
    if (reloadWorktrees) setMenuRefreshCount((count) => count + 1);

    setIsLoadingBranches(true);
    setIsLoadingOperation(true);
    setIsLoadingStashes(true);
    setIsLoadingHistory(true);
    setBranchError(null);
    setMergeError(null);
    setStashError(null);
    setHistoryError(null);

    try {
      const [branchState, opState, stashItems, historyItems] = await Promise.all([
        window.electronAPI.gitGetBranchState(scope.path, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : [])),
        window.electronAPI.gitGetOperationState(scope.path, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : [])),
        window.electronAPI.gitGetStashes(scope.path, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : [])),
        window.electronAPI.gitGetHistory(scope.path, historyLimitRef.current, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : [])),
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
          message: opState.message || opState.error || 'Unable to load merge state',
          error: opState.error,
        });
      }

      setStashes(stashItems);
      setHistory(historyItems);

      // Only refresh diff if user has not explicitly clicked a different selection while refresh was in-flight
      if (diffGeneration.current === startDiffGen) {
        const { mode, ref } = diffSelectionRef.current;
        if (mode === 'commit') {
          // The bounded list is not evidence that an explicitly selected object is gone.
          // Resolve that exact hash through the authorized summary backend instead.
          if (ref) void fetchDiff('commit', ref);
        } else {
          void fetchDiff(mode, null);
        }
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
      setOperationState({
        success: false,
        isRepo: false,
        inProgress: false,
        mode: 'none',
        conflicts: [],
        message,
        error: message,
      });
      setBranchError(message);
      setMergeError(message);
      setStashError(message);
      setHistoryError(message);
    } finally {
      if (fresh()) {
        setIsLoadingBranches(false);
        setIsLoadingOperation(false);
        setIsLoadingStashes(false);
        if (historyGeneration === historyRequest.current) {
          historyLoadingRef.current = false;
          setIsLoadingHistory(false);
        }
      }
    }
  }, [workspacePath, workspaceId, scope.path, scope.checkoutContextId, fetchDiff, loadVcsContext, setBranchError, setStashError, setMergeError, setMergeTargetBranch, isCurrent]);

  refreshMenuDataRef.current = refreshMenuData;



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
      setHistoryLimit(10);
      setSelectedDiffMode('commit');
      setSelectedDiffRef(null);
      setDiffResult(null);
      setDiffError(null);
      diffGeneration.current++;
      setIsMenuOpen(false);
      return;
    }

    window.electronAPI.gitStartPolling(scope.path, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));

    return () => {
      void window.electronAPI.gitStopPolling(workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : [])).catch((error: unknown) => {
        if (error instanceof Error && error.message.includes('Workspace identity is no longer registered')) return;
        console.error('Failed to stop Git polling:', error);
      });
    };
  }, [workspacePath, scope.path, workspaceId, scope.checkoutContextId]);

  const applyStatus = useCallback((status: GitStatusResult) => {
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
        if (status.workspacePath && !sameWorkspacePath(status.workspacePath, scope.path)) {
          return;
        }
        if (scope.checkoutContextId) {
          if (status.checkoutContextId !== scope.checkoutContextId) return;
        } else if (status.checkoutContextId && status.checkoutContextId !== mainCheckoutContextId(activeWs.id)) {
          return;
        }
      } else if (workspacePath && status.workspacePath && !sameWorkspacePath(status.workspacePath, scope.path)) {
        return;
      }
      setStatusKnown(status.success);
      if (status.success) {
        setIsRepo(status.isRepo);
        setChangeCount(changedFileCount(status.changes));
        setChanges(status.changes);
        setCurrentBranch(status.currentBranch);
        setIsDetached(status.isDetached);
        setStatusErrorCode(null);
        setUpstream(status.upstream);
        setAhead(status.ahead);
        setBehind(status.behind);

        if (!scope.checkoutContextId) {
          useWorkspaceStore.getState().setGitChanges(status.isRepo ? status.changes : []);
          useWorkspaceStore.getState().setGitBranchInfo(status.currentBranch, status.isRepo, status.isDetached);
        }
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
        if (!scope.checkoutContextId) {
          useWorkspaceStore.getState().setGitChanges([]);
          useWorkspaceStore.getState().setGitBranchInfo(null, false, false);
        }
      }
  }, [workspacePath, workspaceId, scope.path, scope.checkoutContextId, isCurrent]);

  useEffect(() => window.electronAPI.onGitStatusUpdate(applyStatus), [applyStatus]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    if (!isRepo) {
      return;
    }

    void refreshMenuData();
  }, [isMenuOpen, isRepo, refreshMenuData]);

  const refreshChanges = async () => {
    try {
      const status = await window.electronAPI.gitRefresh(workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));
      if (!isCurrent()) throw new Error('Repository scope changed');
      if (!status?.success) throw new Error(status?.error || 'Could not refresh changes');
      if ((workspaceId && status.workspaceId !== workspaceId) ||
        (status.workspacePath && !sameWorkspacePath(status.workspacePath, scope.path)) ||
        (status.environmentId && status.environmentId !== scope.environmentId)) throw new Error('Repository scope changed');
      if (scope.checkoutContextId && status.checkoutContextId !== scope.checkoutContextId) throw new Error('Repository scope changed');
      applyStatus(status);
      setReviewRevision((value) => value + 1);
    } catch (error) {
      if (isCurrent()) setStatusKnown(false);
      throw error;
    }
  };

  refreshChangesRef.current = refreshChanges;

  // All change mutations share a synchronous lock, authoritative status refresh and scope guard.
  const runChangeMutation = async (action: string, run: () => Promise<{ success: boolean; error?: string }>, reportFileError = true) => {
    if (!isCurrent()) return { success: false, error: 'Repository scope changed' };
    if (changeMutationLock.current || activeAction || remoteAction) return { success: false, error: 'Git operation already pending' };
    changeMutationLock.current = true;
    setActiveAction(action); setChangesError(null);
    try {
      const result = await run();
      if (!isCurrent()) return { success: false, error: 'Repository scope changed' };
      if (!result.success) throw new Error(result.error || 'Git operation failed');
      await refreshChanges();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Git operation failed';
      if (isCurrent() && reportFileError) setChangesError(message);
      return { success: false, error: message };
    } finally {
      changeMutationLock.current = false;
      if (isCurrent()) setActiveAction(null);
    }
  };
  const handleRefreshChanges = async () => {
    if (!isCurrent() || changeMutationLock.current || activeAction || remoteAction) return;
    changeMutationLock.current = true;
    setIsLoadingChanges(true); setChangesError(null);
    try { await refreshChanges(); }
    catch (error) { if (isCurrent()) setChangesError(error instanceof Error ? error.message : 'Could not refresh changes'); }
    finally { changeMutationLock.current = false; if (isCurrent()) setIsLoadingChanges(false); }
  };
  const handleCommit = async (message: string, stageAll: boolean): Promise<{ success: boolean; error?: string; refreshError?: string }> => {
    if (!statusKnown || !message.trim() || !changes.some((change) => stageAll ? !change.staged : change.staged)) {
      return { success: false, error: 'A message and known changes are required' };
    }
    if (!isCurrent()) return { success: false, error: 'Repository scope changed' };
    if (changeMutationLock.current || activeAction || remoteAction) return { success: false, error: 'Git operation already pending' };
    changeMutationLock.current = true;
    setActiveAction(stageAll ? 'commit-all' : 'commit');
    setChangesError(null);
    try {
      if (stageAll) {
        const staged = await window.electronAPI.gitStage(scope.path, undefined, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));
        if (!isCurrent()) return { success: false, error: 'Repository scope changed' };
        if (!staged.success) throw new Error(staged.error || 'Failed to stage changes');
        setActiveAction('commit');
      }
      const committed = await window.electronAPI.gitCommit(scope.path, message, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));
      if (!isCurrent()) return { success: false, error: 'Repository scope changed' };
      if (!committed.success) throw new Error(committed.error || 'Commit failed');

      try {
        await refreshChanges();
        return { success: true };
      } catch (refreshErr) {
        const msg = refreshErr instanceof Error ? refreshErr.message : 'Could not refresh changes';
        if (isCurrent()) {
          setStatusKnown(false);
          setChangesError(`Commit succeeded, but status could not be refreshed: ${msg}. Refresh changes before continuing.`);
        }
        return {
          success: true,
          refreshError: `Commit succeeded, but status could not be refreshed: ${msg}. Refresh changes to update repository status.`,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Git operation failed';
      return { success: false, error: message };
    } finally {
      changeMutationLock.current = false;
      if (isCurrent()) setActiveAction(null);
    }
  };
  const handleStage = () => runChangeMutation('stage-all', () => window.electronAPI.gitStage(scope.path, undefined, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : [])));
  const handleStageFile = (path: string) => runChangeMutation(`stage:${path}`, () => window.electronAPI.gitStage(scope.path, [path], workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : [])));
  const handleUnstageFile = (path: string) => runChangeMutation(`unstage:${path}`, () => window.electronAPI.gitUnstage(scope.path, [path], workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : [])));
  const handleUnstageAll = () => runChangeMutation('unstage-all', () => window.electronAPI.gitUnstage(scope.path, undefined, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : [])));

  const handleInitRepository = async () => {
    if (!isCurrent() || !statusKnown || isInitializing) return;
    setIsInitializing(true);
    setInitError(null);

    try {
      const result = await window.electronAPI.gitInit(workspacePath, selectedDefaultBranch, workspaceId);
      if (!isCurrent()) return;
      if (result.success) {
        await window.electronAPI.gitRefresh(workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));
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

  const handleToggleMenu = () => {
    if (!workspacePath || !isCurrent()) {
      return;
    }

    setIsMenuOpen((value) => !value);
  };



  const commitComposer = useCommitComposer({
    enabled: isMenuOpen, workspacePath: scope.path, workspaceId, environmentId: scope.environmentId,
    checkoutContextId: scope.checkoutContextId,
    revision: `${statusKnown}:${JSON.stringify(changes)}:${reviewRevision}`, isCurrent,
    hasStaged: changes.some((change) => change.staged), hasWorking: changes.some((change) => !change.staged),
    disabled: !statusKnown || isLoadingChanges || activeAction !== null || remoteAction !== null,
    onCommit: handleCommit,
  });
  const isBusy = activeAction !== null || remoteAction !== null || commitComposer.isSubmitting;
  const stashConfirmationOpen = dropDialog !== null || clearDialog !== null;
  const mergeConfirmationOpen = abortDialog !== null;
  const selectedCommit = selectedDiffMode === 'commit'
    ? history.find((entry) => entry.hash === selectedDiffRef) ?? null
    : null;
  const deleteDialogBusy = Boolean(
    deleteDialog &&
      (activeAction === `delete:${deleteDialog.branch}` ||
        activeAction === `force-delete:${deleteDialog.branch}`)
  );
  const dropDialogBusy = Boolean(
    dropDialog && activeAction === `drop:${dropDialog.ref}`
  );
  const clearDialogBusy = activeAction === 'clear-stashes';
  const abortDialogBusy = activeAction === 'abort-operation';

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
            branchConfirmationOpen={deleteDialog !== null}
            stashConfirmationOpen={stashConfirmationOpen}
            mergeConfirmationOpen={mergeConfirmationOpen}
            isScopeCurrent={isCurrent}
            changes={changes}
            changesError={changesError}
            isLoadingChanges={isLoadingChanges}
            reviewRevision={reviewRevision}
            onRefreshChanges={handleRefreshChanges}
            onStageFile={handleStageFile}
            onStageAll={handleStage}
            onUnstageFile={handleUnstageFile}
            onUnstageAll={handleUnstageAll}
            onWorktreesChanged={() => { if (isCurrent()) void Promise.all([refreshMenuDataRef.current(false), window.electronAPI.gitRefresh(workspaceId)]).catch((error: unknown) => { if (isCurrent()) setRemoteError(error instanceof Error ? error.message : 'Refresh failed'); }); }}
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
            hasMoreHistory={hasMoreHistory}
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
            onAbortOperation={() => { if (isCurrent()) handleRequestAbort(operationState?.mode === 'rebase' ? 'rebase' : 'merge', operationState?.conflicts ?? []); }}
            onApplyStash={(stash) => { if (isCurrent()) void handleApplyStash(stash); }}
            onClearStashes={() => { if (isCurrent()) handleClearStashes(); }}
            onLoadMoreHistory={handleLoadMoreHistory}
            onRestoreFocus={() => trigger.current?.focus()}
            onCreateBranch={(event) => { if (isCurrent()) void handleCreateBranch(event); }}
            onDeleteBranch={(branchName) => { if (isCurrent()) handleDeleteBranch(branchName); }}
            onDropStash={(stash) => { if (isCurrent()) handleDropStash(stash); }}
            onFetch={() => { if (isCurrent()) void handleFetch(); }}
            onMergeBranch={() => { if (isCurrent()) void handleMergeBranch(); }}
            commitComposer={commitComposer}
            commitProgress={activeAction === 'commit-all' ? 'Staging changes…' : activeAction === 'commit' ? 'Running git hooks…' : null}
            onPopStash={(stash) => { if (isCurrent()) void handlePopStash(stash); }}
            onPublish={() => { if (isCurrent()) void handlePublish(); }}
            onPull={() => { if (isCurrent()) void handlePull(); }}
            onPush={() => { if (isCurrent()) void handlePush(); }}
            onRefresh={() => { void refreshAfterAction().then(() => { if (isCurrent()) setRemoteError(null); }).catch((error: unknown) => { if (isCurrent()) setRemoteError(error instanceof Error ? error.message : 'Refresh failed'); }); }}
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

      {deleteDialog && (
        <GitDeleteBranchDialog
          currentBranch={currentBranch}
          workspaceId={workspaceId}
          deleteDialog={deleteDialog}
          isBusy={deleteDialogBusy}
          onCancel={closeDeleteDialog}
          onConfirmDelete={(forceDelete) => { if (isCurrent()) void performDeleteBranch(forceDelete); }}
        />
      )}

      {dropDialog && (
        <GitDropStashDialog
          stash={dropDialog}
          workspaceId={workspaceId}
          isBusy={dropDialogBusy}
          onCancel={closeDropDialog}
          onConfirmDrop={() => { if (isCurrent()) void performDropStash(); }}
        />
      )}

      {clearDialog && (
        <GitClearStashesDialog
          stashCount={clearDialog.count}
          workspaceId={workspaceId}
          isBusy={clearDialogBusy}
          onCancel={closeClearDialog}
          onConfirmClear={() => { if (isCurrent()) void performClearStashes(); }}
        />
      )}

      {abortDialog && (
        <GitAbortOperationDialog
          mode={abortDialog.mode}
          conflicts={abortDialog.conflicts}
          workspaceId={workspaceId}
          isBusy={abortDialogBusy}
          onCancel={closeAbortDialog}
          onConfirmAbort={() => { if (isCurrent()) void performAbortOperation(); }}
        />
      )}
    </>
  );
}
