import { Button } from './ui/Button';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gitPresentation } from '../lib/workspaceSwitchDebug';
import { ChevronDown, GitBranch as GitBranchIcon } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useVcsStore } from '../store/vcsStore';
import { matchingCheckoutGit, lastKnownCheckoutGit, useCheckoutGitStore, checkoutGitAvailability } from '../store/checkoutGitStore';
import { GitLastKnown, gitLastKnownTitle } from './git/GitLastKnown';
import { checkoutSelectionToken } from '../lib/checkoutSelectionRuntime';
import { sameWorkspacePath } from '../lib/pathUtils';
import { useGitMenuResources } from './git/useGitMenuResources';
import type { GitMenuPage } from './git/useGitMenuResources';
import { useAgentSnapshot } from '../lib/useAgentLocation';
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
  GitDiffResult,
  GitHistoryEntry,
} from './git/types';
import type { GitChangeMutationResult, GitStatusResult } from '../../shared/types/git';
import { mainCheckoutContextId } from '../../shared/checkoutContext';
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
  useAgentSnapshot(workspace?.activeTerminalId);
  useWorkspaceStore((state) => state.activeWorkspaceId);
  const scope = gitManagementScope(props.workspacePath, props.workspaceId);
  const trigger = useRef<HTMLButtonElement>(null);
  const epoch = props.workspaceId ? checkoutSelectionToken(props.workspaceId) : 0;
  return scope.blocked ? <UnavailableGit key={scope.key} scope={scope} trigger={trigger} /> : <GitController key={`${scope.key}:${epoch}`} {...props} scope={scope} trigger={trigger} />;
}

function UnavailableGit({ scope, trigger }: { scope: ReturnType<typeof gitManagementScope>; trigger: React.RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false);
  return <><Button ref={trigger} size="xs" variant="ghost" aria-label="Source Control" title={scope.blocked ?? undefined} onClick={() => setOpen(true)}><GitBranchIcon size={14} /><span>Checkout unavailable</span></Button>
    <Dialog open={open} onOpenChange={setOpen}><ManagementShell onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }} title="Source Control" items={[{ id: 'overview', label: 'Overview', group: 'Repository' }]} selectedId="overview" onSelect={() => {}}>
      <p>{scope.environmentId === 'local' ? 'Local' : `SSH · ${scope.environmentId}`} · {scope.path}</p><p role="alert">{scope.blocked}</p>
    </ManagementShell></Dialog></>;
}

function GitController({ workspacePath, workspaceId, scope, trigger }: GitButtonProps & { scope: ReturnType<typeof gitManagementScope>; trigger: React.RefObject<HTMLButtonElement | null> }) {
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const selectionEpoch = useRef(workspaceId ? checkoutSelectionToken(workspaceId) : 0);
  const isCurrent = useCallback(() => live.current && gitManagementScope(workspacePath, workspaceId).key === scope.key
    && (!workspaceId || checkoutSelectionToken(workspaceId) === selectionEpoch.current), [workspacePath, workspaceId, scope.key]);
  const statusGeneration = useRef(0);
  const latestStatusSequence = useRef(0);
  const activeStatus = useCheckoutGitStore((state) => state.active);
  const selectedStatus = matchingCheckoutGit(activeStatus, { workspaceId, environmentId: scope.environmentId, contextId: scope.checkoutContextId, root: scope.path, selectionGeneration: selectionEpoch.current });
  const gitAvailability = checkoutGitAvailability(selectedStatus);
  const gitLabel = gitAvailability === 'loading' ? 'Git loading…' : 'Git status unavailable';
  const statusKnown = gitAvailability === 'ready';
  const cached = useCheckoutGitStore(state => lastKnownCheckoutGit(state.cache, { workspaceId, environmentId: scope.environmentId, contextId: scope.checkoutContextId, root: scope.path }));
  const lastKnown = statusKnown ? null : cached;
  const lastKnownTitle = lastKnown ? gitLastKnownTitle(lastKnown, gitAvailability === 'unavailable', selectedStatus?.result?.error) : undefined;
  useLayoutEffect(() => {
    if (import.meta.env.DEV) gitPresentation(workspaceId, selectedStatus?.generation, statusKnown ? 'current'
      : gitAvailability === 'unavailable' ? 'unavailable' : lastKnown ? 'last-known' : 'loading', Boolean(lastKnown));
  }, [workspaceId, selectedStatus?.generation, statusKnown, gitAvailability, lastKnown]);
  const changes = statusKnown ? selectedStatus?.result?.changes ?? [] : [];
  const changeCount = statusKnown ? changedFileCount(changes) : null;
  const setStatusKnown = useCallback((known: boolean) => { if (!known) useCheckoutGitStore.getState().invalidate(statusGeneration.current); }, []);
  const [isRepo, setIsRepo] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [isLoadingChanges, setIsLoadingChanges] = useState(false);
  const [reviewRevision, setReviewRevision] = useState(0);
  const changeMutationLock = useRef(false);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [isDetached, setIsDetached] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [menuPage, setMenuPage] = useState<GitMenuPage>('changes');
  const menuOpenRef = useRef(isMenuOpen);
  menuOpenRef.current = isMenuOpen;
  const isMenuCurrent = useCallback(() => isCurrent() && menuOpenRef.current, [isCurrent]);
  const resources = useGitMenuResources(scope, workspacePath, workspaceId, isMenuCurrent);
  const { readBranches, readOperation, readHistory, readStashes, readRemotes, readProvider, close: closeResources } = resources;
  const branches = useMemo(() => [...(resources.branch.data?.branches ?? [])].sort((a, b) => a.isCurrent !== b.isCurrent ? a.isCurrent ? -1 : 1 : a.name.localeCompare(b.name)), [resources.branch.data]);
  const operationState = resources.operation.data;
  const stashes = resources.stash.data ?? [];
  const history = resources.history.data ?? [];
  const [historyLimit, setHistoryLimit] = useState(10);
  const historyLimitRef = useRef(10);
  const isLoadingBranches = resources.branch.phase === 'loading';
  const isLoadingOperation = resources.operation.phase === 'loading';
  const isLoadingStashes = resources.stash.phase === 'loading';
  const isLoadingHistory = resources.history.phase === 'loading';
  const historyError = resources.history.error;
  const [selectedDiffMode, setSelectedDiffMode] = useState<DiffMode>('commit');
  const [selectedDiffRef, setSelectedDiffRef] = useState<string | null>(null);
  const diffSelectionRef = useRef<{ mode: DiffMode; ref: string | null }>({ mode: 'commit', ref: null });
  diffSelectionRef.current = { mode: selectedDiffMode, ref: selectedDiffRef };
  const [diffResult, setDiffResult] = useState<GitDiffResult | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const diffGeneration = useRef(0);
  const loadedDiffIdentity = useRef<string | null>(null);
  const hasMoreHistory = history.length === historyLimit && historyLimit < 50;
  const [statusErrorCode, setStatusErrorCode] = useState<string | null>(null);
  const [upstream, setUpstream] = useState<string | null>(null);
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const provider = resources.remote.data?.provider ?? 'unknown';
  const vcsProviderContext = resources.provider.data?.provider ?? null;
  const pullRequest = resources.provider.data?.pullRequest ?? null;
  const providerSummaries = resources.provider.data;
  const deepLinks = resources.provider.data?.deepLinks ?? [];
  const isLoadingVcsContext = resources.provider.phase === 'loading';
  const vcsContextError = resources.provider.error;
  const [isInitializing, setIsInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [selectedDefaultBranch, setSelectedDefaultBranch] = useState('main');
  const remotes = resources.remote.data?.remotes ?? [];
  const createBranchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isMenuCurrent() && resources.provider.data) useVcsStore.getState().setContextSnapshot(resources.provider.data);
  }, [resources.provider.data, isMenuCurrent]);
  useEffect(() => () => {
    if (useVcsStore.getState().contextSnapshot?.identity?.workspaceId === workspaceId) useVcsStore.getState().setContextSnapshot(null);
  }, [workspaceId]);

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

  const loadRemotes = useCallback(async () => { await readRemotes(true); }, [readRemotes]);
  const refreshChangesRef = useRef<() => Promise<void>>(async () => {});
  const [menuRefreshCount, setMenuRefreshCount] = useState(0);
  const refreshCurrentAfterAction = async () => {
    try { await refreshChangesRef.current(); }
    catch (error) {
      const message = `Command finished, but status refresh failed: ${error instanceof Error ? error.message : 'Unavailable'}. Refresh changes before continuing.`;
      if (isCurrent()) setChangesError(message);
      throw new Error(message);
    }
  };
  const invalidateHead = () => {
    resources.branch.invalidate(); resources.operation.invalidate(); resources.history.invalidate(); resources.provider.invalidate();
    diffGeneration.current++; setDiffResult(null); setReviewRevision(value => value + 1);
  };
  const refreshAfterBranchAction = async (kind?: 'create' | 'switch' | 'delete') => {
    if (!isCurrent()) return;
    if (kind === 'delete') resources.branch.invalidate(); else invalidateHead();
    setMenuRefreshCount(value => value + 1);
    if (workspaceId) void requestCheckoutReconciliation(workspaceId);
    if (kind !== 'delete') await refreshCurrentAfterAction();
  };
  const refreshAfterStashAction = async (kind?: 'stash' | 'apply' | 'pop' | 'drop' | 'clear') => {
    if (!isCurrent()) return;
    resources.stash.invalidate();
    if (kind === 'drop' || kind === 'clear') return;
    resources.operation.invalidate(); diffGeneration.current++; setDiffResult(null);
    await refreshCurrentAfterAction();
  };
  const refreshAfterMergeAction = async () => {
    if (!isCurrent()) return;
    invalidateHead(); await refreshCurrentAfterAction();
  };
  const refreshAfterRemoteAction = async (kind?: 'fetch' | 'pull' | 'push' | 'publish') => {
    if (!isCurrent()) return;
    if (kind === 'pull') invalidateHead(); else resources.provider.invalidate();
    await refreshCurrentAfterAction();
  };

  const {
    branchError,
    closeDeleteDialog,
    deleteDialog,
    handleCreateBranch,
    handleDeleteBranch,
    handleSwitchBranch,
    newBranchName,
    performDeleteBranch,
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
    refreshAfterAction: refreshAfterRemoteAction,
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
    setStashMessage,
    stashError,
    stashMessage,
  } = useGitStashActions({
    isCurrent,
    activeAction,
    onSetActiveAction: setActiveAction,
    refreshAfterAction: refreshAfterStashAction,
    stashes: resources.stash.phase === 'ready' ? stashes : [],
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
    setMergeTargetBranch,
  } = useGitMergeActions({
    isCurrent,
    activeAction,
    onSetActiveAction: setActiveAction,
    refreshAfterAction: refreshAfterMergeAction,
    workspacePath: scope.path,
    workspaceId,
    checkoutContextId: scope.checkoutContextId,
    operationState: resources.operation.phase === 'ready' && statusKnown ? operationState : null,
  });

  const fetchDiff = useCallback(async (mode: DiffMode, ref: string | null) => {
    if (!workspacePath || !isMenuCurrent()) return;
    const generation = ++diffGeneration.current;
    const identity = JSON.stringify([mode, ref]);
    const fresh = () => isMenuCurrent() && generation === diffGeneration.current;

    if (loadedDiffIdentity.current !== identity) setDiffResult(null);
    setIsLoadingDiff(true);
    setDiffError(null);

    try {
      const commitRef = mode === 'commit' ? ref ?? undefined : undefined;
      const result = await window.electronAPI.gitGetDiff(scope.path, mode, commitRef, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));
      if (!fresh()) return;
      if (result.success) { setDiffResult(result); loadedDiffIdentity.current = identity; }
      if (!result.success) {
        setDiffError(result.error || 'Unable to load summary');
      } else {
        setDiffError(null);
      }
    } catch (error: unknown) {
      if (fresh()) {
        setDiffError(error instanceof Error ? error.message : 'Unable to load summary');
      }
    } finally {
      if (fresh()) {
        setIsLoadingDiff(false);
      }
    }
  }, [scope.path, workspacePath, workspaceId, scope.checkoutContextId, isMenuCurrent]);

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

  const handleLoadMoreHistory = async () => {
    if (!isMenuCurrent() || isLoadingHistory || !hasMoreHistory) return;
    const nextLimit = Math.min(50, historyLimitRef.current + 15);
    if (await readHistory(true, nextLimit) && isMenuCurrent()) {
      historyLimitRef.current = nextLimit; setHistoryLimit(nextLimit);
    }
  };
  useEffect(() => {
    setMergeTargetBranch(previous => availableMergeTargets.includes(previous) ? previous : availableMergeTargets[0] ?? '');
  }, [availableMergeTargets, setMergeTargetBranch]);
  useEffect(() => {
    if (!isMenuOpen) {
      closeResources(); diffGeneration.current++; setIsLoadingDiff(false);
      setMenuPage('changes'); historyLimitRef.current = 10; setHistoryLimit(10);
      setSelectedDiffMode('commit'); setSelectedDiffRef(null); setDiffResult(null); setDiffError(null);
      useVcsStore.getState().setContextSnapshot(null);
    }
  }, [isMenuOpen, closeResources]);
  useEffect(() => {
    if (!isMenuOpen || !isRepo) return;
    if (menuPage === 'branches' || menuPage === 'merge') void readBranches();
    if (menuPage === 'merge' || menuPage === 'overview') void readOperation();
    if (menuPage === 'history') void readHistory(false, historyLimitRef.current);
    if (menuPage === 'stashes') void readStashes();
    if (menuPage === 'remotes' || menuPage === 'overview') void readRemotes();
    if (menuPage === 'branches' || menuPage === 'overview') void readProvider();
  }, [isMenuOpen, isRepo, menuPage, readBranches, readOperation, readHistory, readStashes, readRemotes, readProvider,
    resources.branch.phase, resources.operation.phase, resources.history.phase, resources.stash.phase, resources.remote.phase, resources.provider.phase]);
  const refreshPage = () => {
    if (!isMenuCurrent()) return;
    if (menuPage === 'branches' || menuPage === 'merge') void readBranches(true);
    if (menuPage === 'merge' || menuPage === 'overview') void readOperation(true);
    if (menuPage === 'history') {
      void readHistory(true, historyLimitRef.current);
      const { mode, ref } = diffSelectionRef.current;
      if (mode !== 'commit' || ref) void fetchDiff(mode, ref);
    }
    if (menuPage === 'stashes') void readStashes(true);
    if (menuPage === 'remotes' || menuPage === 'overview') void readRemotes(true);
    if (menuPage === 'overview') { void readProvider(true); void handleRefreshChanges(); }
  };



  useEffect(() => {
    if (!workspacePath) {
      setStatusKnown(false);
      setIsRepo(false);
      useWorkspaceStore.getState().setGitChanges([]);
      useWorkspaceStore.getState().setGitBranchInfo(null, false, false);
      setCurrentBranch(null);
      setIsDetached(false);
      setStatusErrorCode(null);
      setUpstream(null);
      setAhead(0);
      setBehind(0);

      setHistoryLimit(10);
      setSelectedDiffMode('commit');
      setSelectedDiffRef(null);
      setDiffResult(null);
      setDiffError(null);
      diffGeneration.current++;
      setIsMenuOpen(false);
      return;
    }

    const generation = useCheckoutGitStore.getState().begin({ workspaceId, environmentId: scope.environmentId, contextId: scope.checkoutContextId, root: scope.path, selectionGeneration: selectionEpoch.current });
    statusGeneration.current = generation;
    latestStatusSequence.current = 0;
    void Promise.resolve(window.electronAPI.gitStartPolling(scope.path, workspaceId, scope.checkoutContextId, generation)).catch(() => {
      if (isCurrent()) useCheckoutGitStore.getState().invalidate(generation);
    });

    return () => {
      useCheckoutGitStore.getState().clear(generation);
      void window.electronAPI.gitStopPolling(workspaceId, scope.checkoutContextId, generation).catch((error: unknown) => {
        if (error instanceof Error && error.message.includes('Workspace identity is no longer registered')) return;
        console.error('Failed to stop Git polling:', error);
      });
    };
  }, [workspacePath, scope.path, workspaceId, scope.checkoutContextId, scope.environmentId, isCurrent, setStatusKnown]);

  const applyStatus = useCallback((status: GitStatusResult) => {
      if (!isCurrent() || (status.presentationGeneration !== undefined && status.presentationGeneration !== statusGeneration.current)
        || status.acquisitionSequence !== undefined && status.acquisitionSequence <= latestStatusSequence.current) return;
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
      useCheckoutGitStore.getState().apply(statusGeneration.current, status);
      if (useCheckoutGitStore.getState().active?.result !== status) return;
      if (status.acquisitionSequence !== undefined) latestStatusSequence.current = status.acquisitionSequence;
      if (status.success) {
        setIsRepo(status.isRepo);
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
        // Keep a previously verified controller's Changes surface available for recovery.
        // statusKnown remains false; history never supplies repo/action authority.
        setCurrentBranch(null);
        setIsDetached(false);
        setStatusErrorCode(status.errorCode ?? null);
        setUpstream(null);
        setAhead(0);
        setBehind(0);
        if (!scope.checkoutContextId) {
          useWorkspaceStore.getState().setGitChanges([]);
          // Failed acquisition is not proof that the registered checkout/branch vanished.
          // Retain descriptive main metadata; snapshot availability still gates all counts/actions.
        }
      }
  }, [workspacePath, workspaceId, scope.path, scope.checkoutContextId, isCurrent]);

  useEffect(() => window.electronAPI.onGitStatusUpdate(applyStatus), [applyStatus]);

  const refreshChanges = async () => {
    try {
      const status = await window.electronAPI.gitRefresh(workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));
      if (!isCurrent()) throw new Error('Repository scope changed');
      if (status?.acquisitionSequence !== undefined && status.acquisitionSequence < latestStatusSequence.current
        && useCheckoutGitStore.getState().active?.state === 'ready') return;
      if (!status?.success) { if (status) applyStatus(status); throw new Error(status?.error || 'Could not refresh changes'); }
      if ((workspaceId && status.workspaceId !== workspaceId) ||
        (status.workspacePath && !sameWorkspacePath(status.workspacePath, scope.path)) ||
        (status.environmentId && status.environmentId !== scope.environmentId)) throw new Error('Repository scope changed');
      if (scope.checkoutContextId && status.checkoutContextId !== scope.checkoutContextId) throw new Error('Repository scope changed');
      applyStatus(status);
      if (useCheckoutGitStore.getState().active?.state !== 'ready') throw new Error('Newer status acquisition is unavailable');
      setReviewRevision((value) => value + 1);
    } catch (error) {
      if (isCurrent()) setStatusKnown(false);
      throw error;
    }
  };

  refreshChangesRef.current = refreshChanges;

  const consumeMutationStatus = (result: GitChangeMutationResult): string | undefined => {
    if (!isCurrent()) return 'Repository scope changed';
    const status = result.status;
    if (!status || status.presentationGeneration !== statusGeneration.current
      || workspaceId && status.workspaceId !== workspaceId || status.environmentId && status.environmentId !== scope.environmentId
      || status.workspacePath && !sameWorkspacePath(status.workspacePath, scope.path)
      || (status.checkoutContextId ?? (workspaceId ? mainCheckoutContextId(workspaceId) : undefined))
        !== (scope.checkoutContextId ?? (workspaceId ? mainCheckoutContextId(workspaceId) : undefined))) {
      setStatusKnown(false); return result.refreshError || 'No verified status returned. Refresh changes before continuing.';
    }
    applyStatus(status);
    setReviewRevision(value => value + 1);
    const snapshot = useCheckoutGitStore.getState().active;
    return result.refreshError || (snapshot?.generation === statusGeneration.current && snapshot.state === 'ready' ? undefined : 'Status unavailable. Refresh changes before continuing.');
  };

  // Main owns the one post-mutation acquisition; its same scoped response is applied without another read.
  const runChangeMutation = async (action: string, run: () => Promise<GitChangeMutationResult>, reportFileError = true) => {
    if (!isCurrent() || !statusKnown) return { success: false, error: 'Known current changes are required' };
    if (changeMutationLock.current || activeAction || remoteAction) return { success: false, error: 'Git operation already pending' };
    changeMutationLock.current = true;
    setActiveAction(action); setChangesError(null);
    try {
      const result = await run();
      const refreshError = consumeMutationStatus(result);
      if (isCurrent() && reportFileError) setChangesError(result.success
        ? refreshError ? `${action.startsWith('unstage') ? 'Unstage' : 'Stage'} succeeded, but status could not be refreshed: ${refreshError}` : null
        : `${result.error || 'Git operation failed'}${refreshError ? `. Status refresh failed: ${refreshError}` : ''}`);
      diffGeneration.current++; setDiffResult(null);
      return { ...result, refreshError };
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
    try { await refreshChanges(); if (isCurrent()) setRemoteError(null); }
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
        consumeMutationStatus(staged);
        if (!staged.success) return { success: false, error: staged.error || 'Failed to stage changes', refreshError: staged.refreshError };
        if (!isCurrent()) return { success: false, error: 'Staging succeeded; repository scope changed before commit' };
        setActiveAction('commit');
      }
      const committed = await window.electronAPI.gitCommit(scope.path, message, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));
      const refreshError = consumeMutationStatus(committed);
      if (isCurrent()) {
        invalidateHead();
        if (refreshError) setChangesError(`${committed.success ? 'Commit succeeded, but' : 'Commit failed and'} status could not be refreshed: ${refreshError}. Refresh changes before continuing.`);
      }
      return { success: committed.success,
        error: committed.success ? undefined : `${stageAll ? 'Staging succeeded, but commit failed: ' : ''}${committed.error || 'Commit failed'}${refreshError ? `. Status refresh failed: ${refreshError}` : ''}`,
        refreshError: refreshError ? `Commit ${committed.success ? 'succeeded' : 'failed'}, but status could not be refreshed: ${refreshError}. Refresh changes to update repository status.` : undefined };
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
    if (!isCurrent() || !statusKnown || isRepo || isInitializing) return;
    setIsInitializing(true);
    setInitError(null);

    try {
      const result = await window.electronAPI.gitInit(scope.path, selectedDefaultBranch, workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));
      if (!isCurrent()) return;
      if (result.success) {
        await window.electronAPI.gitRefresh(workspaceId, ...(scope.checkoutContextId ? [scope.checkoutContextId] : []));
        if (isCurrent()) setIsMenuOpen(false);
      } else {
        setInitError(result.error || 'Failed to initialize repository');
      }
    } catch (error: unknown) {
      if (isCurrent()) setInitError(error instanceof Error ? error.message : 'Failed to initialize repository');
    } finally {
      if (isCurrent()) setIsInitializing(false);
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
          aria-description={lastKnownTitle}
          title={lastKnownTitle ?? (!statusKnown ? gitLabel : !isRepo ? 'Initialize Git Repository' : currentBranch ? `Git - ${currentBranch}` : 'Git - View changes and branches')}
        >
          <GitBranchIcon size={14} strokeWidth={2} />
          {lastKnown ? <GitLastKnown description={lastKnown} unavailable={gitAvailability === 'unavailable'} />
            : !statusKnown ? <span data-git-state={gitAvailability} title={gitLabel}>{gitAvailability === 'loading' ? 'Git…' : 'Git unavailable'}</span> : !isRepo && <span>Init Git</span>}
          {changeCount !== null && changeCount > 0 && (
            <span className="git-badge">{changeCount > 99 ? '99+' : changeCount}</span>
          )}
          <ChevronDown size={12} strokeWidth={2.5} />
        </Button>

        <Dialog open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        {isRepo || !statusKnown ? <GitRepoMenu
            scope={scope}
            page={menuPage}
            onSelectPage={setMenuPage}
            resources={resources}
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
            onWorktreesChanged={() => { if (isCurrent()) resources.branch.invalidate(); }}
            activeAction={activeAction}
            ahead={ahead}
            availableMergeTargets={availableMergeTargets}
            behind={behind}
            branchError={branchError}
            branches={branches}
            changeCount={changeCount ?? 0}
            createBranchInputRef={createBranchInputRef}
            currentBranch={currentBranch}
            currentBranchLabel={currentBranchLabel}
            deepLinks={deepLinks}
            diffError={diffError}
            diffResult={diffResult}
            hasMoreHistory={hasMoreHistory}
            historyLimit={historyLimit}
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
            onAbortOperation={() => { if (isCurrent() && statusKnown && resources.operation.phase === 'ready') handleRequestAbort(operationState?.mode === 'rebase' ? 'rebase' : 'merge', operationState?.conflicts ?? []); }}
            onApplyStash={(stash) => { if (isCurrent() && statusKnown && resources.stash.phase === 'ready') void handleApplyStash(stash); }}
            onClearStashes={() => { if (isCurrent() && statusKnown && resources.stash.phase === 'ready') handleClearStashes(); }}
            onLoadMoreHistory={handleLoadMoreHistory}
            onRestoreFocus={() => trigger.current?.focus()}
            onCreateBranch={(event, baseBranch) => { if (isCurrent() && statusKnown && resources.branch.phase === 'ready') void handleCreateBranch(event, baseBranch); }}
            onDeleteBranch={(branchName) => { if (isCurrent() && statusKnown && resources.branch.phase === 'ready') handleDeleteBranch(branchName); }}
            onDropStash={(stash) => { if (isCurrent() && statusKnown && resources.stash.phase === 'ready') handleDropStash(stash); }}
            onFetch={() => { if (isCurrent()) void handleFetch(); }}
            onMergeBranch={() => { if (isCurrent() && statusKnown && resources.operation.phase === 'ready' && resources.branch.phase === 'ready') void handleMergeBranch(); }}
            commitComposer={commitComposer}
            commitProgress={activeAction === 'commit-all' ? 'Staging changes…' : activeAction === 'commit' ? 'Running git hooks…' : null}
            onPopStash={(stash) => { if (isCurrent() && statusKnown && resources.stash.phase === 'ready') void handlePopStash(stash); }}
            onPublish={() => { if (isCurrent()) void handlePublish(); }}
            onPull={() => { if (isCurrent()) void handlePull(); }}
            onPush={() => { if (isCurrent()) void handlePush(); }}
            onRefresh={refreshPage}
            onRefreshContext={() => void readProvider(true)}
            onRemotesChanged={() => { resources.provider.invalidate(); void readRemotes(true); }}
            onSelectCommitDiff={(commit) => void handleSelectCommitDiff(commit)}
            onSelectWorkingDiff={(mode) => void handleSelectWorkingDiff(mode)}
            onSetIncludeUntracked={setIncludeUntracked}
            onSetMergeTargetBranch={setMergeTargetBranch}
            onSetNewBranchName={setNewBranchName}
            onSetRemoteError={setRemoteError}
            onSetStashMessage={setStashMessage}
            onStash={() => { if (isCurrent() && statusKnown && resources.stash.phase === 'ready') void handleStash(); }}
            onSwitchBranch={(branchName) => { if (isCurrent() && statusKnown && resources.branch.phase === 'ready') void handleSwitchBranch(branchName); }}
            operationState={operationState}
            provider={provider}
            providerContext={vcsProviderContext}
            pullRequest={pullRequest}
            ci={providerSummaries?.ci}
            review={providerSummaries?.review}
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
            <Button disabled={isLoadingChanges} onClick={() => void handleRefreshChanges()}>Refresh changes</Button>
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
