import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Download,
  GitBranch as GitBranchIcon,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import CommitDialog from './CommitDialog';
import { GitBranchesSection } from './git/GitBranchesSection';
import { GitHistorySection } from './git/GitHistorySection';
import { GitMergeSection } from './git/GitMergeSection';
import GitRemotesSection from './git/GitRemotesSection';
import { GitStashSection } from './git/GitStashSection';
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
import './GitButton.css';

interface GitButtonProps {
  workspacePath: string;
}

type DeleteDialogStage = 'confirm' | 'force';

interface DeleteDialogState {
  branch: string;
  stage: DeleteDialogStage;
  detail?: string;
}

export default function GitButton({ workspacePath }: GitButtonProps) {
  const [changeCount, setChangeCount] = useState(0);
  const [isRepo, setIsRepo] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [changes, setChanges] = useState<GitStatus[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [isDetached, setIsDetached] = useState(false);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [operationState, setOperationState] = useState<GitOperationState | null>(null);
  const [isLoadingOperation, setIsLoadingOperation] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeTargetBranch, setMergeTargetBranch] = useState('');
  const [stashMessage, setStashMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [stashError, setStashError] = useState<string | null>(null);
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
  const [remoteAction, setRemoteAction] = useState<'fetch' | 'pull' | 'push' | 'publish' | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const createBranchInputRef = useRef<HTMLInputElement>(null);

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

  const statusErrorMessage = useMemo(() => {
    switch (statusErrorCode) {
      case 'git-not-found':
        return 'Git is not installed or not found on PATH';
      case 'not-a-repo':
        return 'Not a git repository';
      default:
        return null;
    }
  }, [statusErrorCode]);

  const upstreamLabel = useMemo(() => {
    if (!upstream) {
      return null;
    }
    if (ahead === 0 && behind === 0) {
      return 'up to date';
    }
    const parts: string[] = [];
    if (ahead > 0) parts.push(`↑${ahead}`);
    if (behind > 0) parts.push(`↓${behind}`);
    return parts.join(' ');
  }, [upstream, ahead, behind]);

  const loadVcsContext = useCallback(async () => {
    if (!workspacePath || provider === 'unknown') {
      // Skip VCS context for unknown provider
      setVcsProviderContext(null);
      setPullRequest(null);
      setDeepLinks([]);
      return;
    }

    setIsLoadingVcsContext(true);
    setVcsContextError(null);

    try {
      // Get full VCS context including PR info
      const result = await window.electronAPI.vcsGetContext(workspacePath);

      if (result.success && result.provider) {
        setVcsProviderContext(result.provider as ProviderContext);
        setPullRequest(result.pullRequest as PullRequestContext | null);
        setDeepLinks(result.deepLinks ?? []);
      } else {
        setVcsProviderContext(null);
        setPullRequest(null);
        setDeepLinks([]);
      }
    } catch (error: any) {
      setVcsContextError(error?.message || 'Failed to load provider context');
    } finally {
      setIsLoadingVcsContext(false);
    }
  }, [workspacePath, provider]);

  const loadRemotes = useCallback(async () => {
    if (!workspacePath) {
      return;
    }

    try {
      const remotesResult = await window.electronAPI.gitGetRemotes(workspacePath);
      if (remotesResult.success) {
        setRemotes(remotesResult.remotes);
        setProvider(remotesResult.provider);
      } else {
        setRemotes([]);
      }
    } catch {
      // Silently fail - remotes are not critical
      setRemotes([]);
    }
  }, [workspacePath]);

  useEffect(() => {
    if (!workspacePath) {
      setRemotes([]);
      return;
    }
    void loadRemotes();
  }, [workspacePath, loadRemotes]);

  const refreshMenuData = useCallback(async () => {
    if (!workspacePath) {
      return;
    }

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
        window.electronAPI.gitGetBranchState(workspacePath),
        window.electronAPI.gitGetOperationState(workspacePath),
        window.electronAPI.gitGetStashes(workspacePath),
        window.electronAPI.gitGetHistory(workspacePath, 8),
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

      const diff = await window.electronAPI.gitGetDiff(
        workspacePath,
        selectedDiffMode,
        diffRef
      );
      setDiffResult(diff);
      if (!diff.success) {
        setDiffError(diff.error || 'Unable to load diff');
      }

      // Load remotes for provider detection
      const remotesResult = await window.electronAPI.gitGetRemotes(workspacePath);
      if (remotesResult.success) {
        setProvider(remotesResult.provider);
        setRemotes(remotesResult.remotes);
      } else {
        setRemotes([]);
      }

      // Load VCS context after provider is detected
      await loadVcsContext();
    } catch (error: any) {
      const message = error?.message || 'Unable to load git data';
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
  }, [selectedDiffMode, selectedDiffRef, workspacePath, loadVcsContext]);

  const loadDiff = async (mode: DiffMode, ref?: string) => {
    if (!workspacePath) {
      return;
    }

    setSelectedDiffMode(mode);
    setSelectedDiffRef(mode === 'commit' ? ref ?? null : null);
    setIsLoadingDiff(true);
    setDiffError(null);

    try {
      const diff = await window.electronAPI.gitGetDiff(workspacePath, mode, ref);
      setDiffResult(diff);
      if (!diff.success) {
        setDiffError(diff.error || 'Unable to load diff');
      }
    } catch (error: any) {
      setDiffError(error?.message || 'Unable to load diff');
    } finally {
      setIsLoadingDiff(false);
    }
  };

  // Start/stop polling when workspace changes
  useEffect(() => {
    if (!workspacePath) {
      setChangeCount(0);
      setIsRepo(false);
      setChanges([]);
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

    window.electronAPI.gitStartPolling(workspacePath);

    // Load remotes once per workspace (provider is stable for normal use)
    void (async () => {
      try {
        const result = await window.electronAPI.gitGetRemotes(workspacePath);
        if (result.success) {
          setProvider(result.provider);
        }
      } catch {
        // non-fatal — remotes are optional
      }
    })();

    return () => {
      window.electronAPI.gitStopPolling();
    };
  }, [workspacePath]);

  // Listen for status updates from the backend
  useEffect(() => {
    const unsubscribe = window.electronAPI.onGitStatusUpdate((status) => {
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
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    window.setTimeout(() => createBranchInputRef.current?.focus(), 50);
    void refreshMenuData();

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isMenuOpen, refreshMenuData]);

  const refreshAfterAction = useCallback(async () => {
    await Promise.all([refreshMenuData(), window.electronAPI.gitRefresh()]);
  }, [refreshMenuData]);

  const handleCommit = async (message: string) => {
    return window.electronAPI.gitCommit(workspacePath, message);
  };

  const handleStage = async () => {
    await window.electronAPI.gitStage(workspacePath);
  };

  const handleFetch = async () => {
    setRemoteAction('fetch');
    setRemoteError(null);

    try {
      const result = await window.electronAPI.gitFetch(workspacePath);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setRemoteError(result.error || 'Fetch failed');
      }
    } catch (error: any) {
      setRemoteError(error?.message || 'Fetch failed');
    } finally {
      setRemoteAction(null);
    }
  };

  const handlePull = async () => {
    setRemoteAction('pull');
    setRemoteError(null);

    try {
      const result = await window.electronAPI.gitPull(workspacePath);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setRemoteError(result.error || 'Pull failed');
      }
    } catch (error: any) {
      setRemoteError(error?.message || 'Pull failed');
    } finally {
      setRemoteAction(null);
    }
  };

  const handlePush = async () => {
    setRemoteAction('push');
    setRemoteError(null);

    try {
      const result = await window.electronAPI.gitPush(workspacePath);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setRemoteError(result.error || 'Push failed');
      }
    } catch (error: any) {
      setRemoteError(error?.message || 'Push failed');
    } finally {
      setRemoteAction(null);
    }
  };

  const handlePublish = async () => {
    if (!currentBranch) {
      return;
    }

    const targetRemote = remotes[0]?.name ?? 'origin';

    setRemoteAction('publish');
    setRemoteError(null);

    try {
      const result = await window.electronAPI.gitPush(workspacePath, targetRemote, currentBranch, false, true);
      if (result.success) {
        await refreshAfterAction();
        void loadRemotes();
        setRemoteError(null);
      } else {
        setRemoteError(result.error || 'Publish failed');
      }
    } catch (error: any) {
      setRemoteError(error?.message || 'Publish failed');
    } finally {
      setRemoteAction(null);
    }
  };

  const handleUnstageFile = async (path: string): Promise<{ success: boolean; error?: string }> => {
    const result = await window.electronAPI.gitUnstage(workspacePath, [path]);
    if (result.success) {
      const status = await window.electronAPI.gitRefresh();
      if (status) {
        setChanges(status.changes);
        setChangeCount(status.changes.length);
      }
    }
    return result;
  };

  const handleUnstageAll = async (): Promise<{ success: boolean; error?: string }> => {
    const result = await window.electronAPI.gitUnstage(workspacePath);
    if (result.success) {
      const status = await window.electronAPI.gitRefresh();
      if (status) {
        setChanges(status.changes);
        setChangeCount(status.changes.length);
      }
    }
    return result;
  };

  const handleOpenCommitDialog = async () => {
    const status = await window.electronAPI.gitRefresh();
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

  const handleCreateBranch = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!newBranchName.trim()) {
      setBranchError('Enter a branch name');
      return;
    }

    setActiveAction('create');
    setBranchError(null);

    try {
      const result = await window.electronAPI.gitCreateBranch(
        workspacePath,
        newBranchName,
        currentBranch ?? undefined
      );

      if (result.success) {
        setNewBranchName('');
        await refreshAfterAction();
      } else {
        setBranchError(result.error || 'Failed to create branch');
      }
    } catch (error: any) {
      setBranchError(error?.message || 'Failed to create branch');
    } finally {
      setActiveAction(null);
    }
  };

  const handleSwitchBranch = async (branchName: string) => {
    setActiveAction(`switch:${branchName}`);
    setBranchError(null);

    try {
      const result = await window.electronAPI.gitSwitchBranch(workspacePath, branchName);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setBranchError(result.error || 'Failed to switch branch');
      }
    } catch (error: any) {
      setBranchError(error?.message || 'Failed to switch branch');
    } finally {
      setActiveAction(null);
    }
  };

  const handleDeleteBranch = (branchName: string) => {
    setBranchError(null);
    setDeleteDialog({ branch: branchName, stage: 'confirm' });
  };

  const closeDeleteDialog = () => {
    if (activeAction) {
      return;
    }

    setDeleteDialog(null);
  };

  const performDeleteBranch = async (forceDelete = false) => {
    if (!workspacePath || !deleteDialog) {
      return;
    }

    const branchName = deleteDialog.branch;
    const actionKey = forceDelete ? `force-delete:${branchName}` : `delete:${branchName}`;
    setActiveAction(actionKey);
    setBranchError(null);

    try {
      const result = forceDelete
        ? await window.electronAPI.gitForceDeleteBranch(workspacePath, branchName)
        : await window.electronAPI.gitDeleteBranch(workspacePath, branchName);

      if (result.success) {
        setDeleteDialog(null);
        await refreshAfterAction();
        return;
      }

      if (!forceDelete && result.blockedByUnmergedCommits) {
        setDeleteDialog({
          branch: branchName,
          stage: 'force',
          detail: result.error,
        });
        return;
      }

      setDeleteDialog(null);
      setBranchError(result.error || 'Failed to delete branch');
    } catch (error: any) {
      setDeleteDialog(null);
      setBranchError(error?.message || 'Failed to delete branch');
    } finally {
      setActiveAction(null);
    }
  };

  const handleMergeBranch = async () => {
    if (!mergeTargetBranch) {
      setMergeError('Select a branch to merge');
      return;
    }

    setActiveAction(`merge:${mergeTargetBranch}`);
    setMergeError(null);

    try {
      const result = await window.electronAPI.gitMergeBranch(workspacePath, mergeTargetBranch);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setMergeError(result.error || 'Failed to merge branch');
      }
    } catch (error: any) {
      setMergeError(error?.message || 'Failed to merge branch');
    } finally {
      setActiveAction(null);
    }
  };

  const handleAbortOperation = async () => {
    setActiveAction('abort-operation');
    setMergeError(null);

    try {
      const result = await window.electronAPI.gitAbortOperation(workspacePath);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setMergeError(result.error || 'Failed to abort operation');
      }
    } catch (error: any) {
      setMergeError(error?.message || 'Failed to abort operation');
    } finally {
      setActiveAction(null);
    }
  };

  const handleStash = async () => {
    setActiveAction('stash');
    setStashError(null);

    try {
      const result = await window.electronAPI.gitStash(
        workspacePath,
        stashMessage,
        includeUntracked
      );

      if (result.success) {
        setStashMessage('');
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to stash changes');
      }
    } catch (error: any) {
      setStashError(error?.message || 'Failed to stash changes');
    } finally {
      setActiveAction(null);
    }
  };

  const handleApplyStash = async (stashRef: string) => {
    setActiveAction(`apply:${stashRef}`);
    setStashError(null);

    try {
      const result = await window.electronAPI.gitApplyStash(workspacePath, stashRef);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to apply stash');
      }
    } catch (error: any) {
      setStashError(error?.message || 'Failed to apply stash');
    } finally {
      setActiveAction(null);
    }
  };

  const handlePopStash = async (stashRef: string) => {
    setActiveAction(`pop:${stashRef}`);
    setStashError(null);

    try {
      const result = await window.electronAPI.gitPopStash(workspacePath, stashRef);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to pop stash');
      }
    } catch (error: any) {
      setStashError(error?.message || 'Failed to pop stash');
    } finally {
      setActiveAction(null);
    }
  };

  const handleDropStash = async (stashRef: string) => {
    const confirmed = window.confirm(`Drop ${stashRef}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setActiveAction(`drop:${stashRef}`);
    setStashError(null);

    try {
      const result = await window.electronAPI.gitDropStash(workspacePath, stashRef);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to drop stash');
      }
    } catch (error: any) {
      setStashError(error?.message || 'Failed to drop stash');
    } finally {
      setActiveAction(null);
    }
  };

  const handleClearStashes = async () => {
    const confirmed = window.confirm('Clear all stashes? This cannot be undone.');
    if (!confirmed) {
      return;
    }

    setActiveAction('clear-stashes');
    setStashError(null);

    try {
      const result = await window.electronAPI.gitClearStashes(workspacePath);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setStashError(result.error || 'Failed to clear stashes');
      }
    } catch (error: any) {
      setStashError(error?.message || 'Failed to clear stashes');
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
    return null;
  }

  const isBusy = activeAction !== null;
  const selectedCommit = selectedDiffMode === 'commit'
    ? history.find((entry) => entry.hash === selectedDiffRef) ?? null
    : null;
  const deleteDialogBusy = Boolean(
    deleteDialog &&
      (activeAction === `delete:${deleteDialog.branch}` || activeAction === `force-delete:${deleteDialog.branch}`)
  );

  return (
    <>
      <div className="git-menu-container" ref={menuRef}>
        <button
          className="header-btn git-btn"
          onClick={handleToggleMenu}
          title={currentBranch ? `Git - ${currentBranch}` : 'Git - View changes and branches'}
        >
          <GitBranchIcon size={15} strokeWidth={2} />
          {changeCount > 0 && (
            <span className="git-badge">{changeCount > 99 ? '99+' : changeCount}</span>
          )}
          <ChevronDown size={12} strokeWidth={2.5} />
        </button>

        {isMenuOpen && (
          <div className="git-menu" role="menu" aria-label="Git actions">
            <div className="git-menu-header">
              <div>
                <div className="git-menu-label">Current Branch</div>
                <div className={`git-menu-branch ${isDetached ? 'detached' : ''}`}>
                  {currentBranchLabel}
                </div>
                {upstream && (
                  <div className="git-menu-upstream">{upstream}</div>
                )}
              </div>

              <div className="git-menu-header-right">
                {provider !== 'unknown' && (
                  <span className={`git-menu-provider provider-${provider}`}>
                    {provider === 'github' && 'GitHub'}
                    {provider === 'bitbucket' && 'Bitbucket'}
                    {provider === 'gitlab' && 'GitLab'}
                  </span>
                )}
                {provider === 'unknown' && (
                  <span className="git-menu-provider provider-none">no remote</span>
                )}

                <button
                  type="button"
                  className="git-menu-close"
                  onClick={() => setIsMenuOpen(false)}
                  title="Close"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="git-menu-summary">
              <span>{changeCount} changed</span>
              {upstreamLabel && (
                <span className={`git-menu-sync ${ahead === 0 && behind === 0 ? 'synced' : 'diverged'}`}>
                  {ahead === 0 && behind === 0
                    ? upstreamLabel
                    : `${upstreamLabel}`}
                  {ahead > 0 && <ArrowUp size={10} />}
                  {behind > 0 && <ArrowDown size={10} />}
                </span>
              )}
              {!upstream && !isDetached && currentBranch && (
                <span className="git-menu-sync none">no upstream</span>
              )}
              {isDetached && <span>Detached HEAD</span>}
              {operationState?.inProgress && <span>{operationState.message}</span>}
            </div>

            {statusErrorMessage && <div className="git-menu-error">{statusErrorMessage}</div>}
            {branchError && <div className="git-menu-error">{branchError}</div>}
            {mergeError && <div className="git-menu-error">{mergeError}</div>}
            {stashError && <div className="git-menu-error">{stashError}</div>}
            {historyError && <div className="git-menu-error">{historyError}</div>}
            {diffError && <div className="git-menu-error">{diffError}</div>}

            <div className="git-menu-actions">
              <button
                type="button"
                className="header-btn header-btn-primary git-menu-action"
                onClick={handleOpenCommitDialog}
              >
                Commit Changes
              </button>
              <button
                type="button"
                className="header-btn git-menu-action"
                onClick={() => void refreshMenuData()}
                disabled={isBusy || isLoadingBranches || isLoadingOperation || isLoadingHistory}
              >
                <RefreshCw size={13} className={isBusy ? 'spin' : ''} />
                Refresh
              </button>
            </div>

            {remoteError && <div className="git-menu-error">{remoteError}</div>}

            {!isDetached && (
              <div className="git-menu-section">
                <div className="git-menu-section-header">
                  <span>Remote</span>
                </div>
                <div className="git-menu-remote-actions">
                  <button
                    type="button"
                    className="header-btn git-menu-action"
                    onClick={() => void handleFetch()}
                    disabled={isBusy || remoteAction !== null}
                  >
                    <Download size={13} className={remoteAction === 'fetch' ? 'spin' : ''} />
                    {remoteAction === 'fetch' ? 'Fetching...' : 'Fetch'}
                  </button>
                  <button
                    type="button"
                    className="header-btn git-menu-action"
                    onClick={() => void handlePull()}
                    disabled={isBusy || remoteAction !== null || !upstream}
                    title={!upstream ? 'Set an upstream branch to enable pull' : undefined}
                  >
                    <Download size={13} className={remoteAction === 'pull' ? 'spin' : ''} />
                    {remoteAction === 'pull' ? 'Pulling...' : 'Pull'}
                  </button>
                  {!upstream && currentBranch && (
                    <button
                      type="button"
                    className="header-btn git-menu-action"
                    onClick={() => void handlePublish()}
                    disabled={remoteAction !== null}
                    title={remotes.length === 0 ? 'Add a remote to publish this branch' : undefined}
                  >
                      <Upload size={13} className={remoteAction === 'publish' ? 'spin' : ''} />
                      {remoteAction === 'publish' ? 'Publishing...' : 'Publish branch'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="header-btn git-menu-action"
                    onClick={() => void handlePush()}
                    disabled={isBusy || remoteAction !== null || !upstream}
                    title={!upstream ? 'Set an upstream branch to enable push' : undefined}
                  >
                    <Upload size={13} className={remoteAction === 'push' ? 'spin' : ''} />
                    {remoteAction === 'push' ? 'Pushing...' : 'Push'}
                  </button>
                </div>
              </div>
            )}

            <GitBranchesSection
              activeAction={activeAction}
              branches={branches}
              createBranchInputRef={createBranchInputRef}
              currentBranch={currentBranch}
              isBusy={isBusy}
              isLoadingBranches={isLoadingBranches}
              newBranchName={newBranchName}
              onCreateBranch={handleCreateBranch}
              onDeleteBranch={(branchName) => void handleDeleteBranch(branchName)}
              onSetNewBranchName={setNewBranchName}
              onSwitchBranch={(branchName) => void handleSwitchBranch(branchName)}
              provider={vcsProviderContext}
              pullRequest={pullRequest}
              deepLinks={deepLinks}
              isLoadingContext={isLoadingVcsContext}
              contextError={vcsContextError}
              onRefreshContext={() => void loadVcsContext()}
              workspacePath={workspacePath}
            />

            <GitStashSection
              activeAction={activeAction}
              includeUntracked={includeUntracked}
              isBusy={isBusy}
              isLoadingStashes={isLoadingStashes}
              onApplyStash={(stashRef) => void handleApplyStash(stashRef)}
              onClearStashes={() => void handleClearStashes()}
              onDropStash={(stashRef) => void handleDropStash(stashRef)}
              onPopStash={(stashRef) => void handlePopStash(stashRef)}
              onSetIncludeUntracked={setIncludeUntracked}
              onSetStashMessage={setStashMessage}
              onStash={() => void handleStash()}
              stashMessage={stashMessage}
              stashes={stashes}
            />

            <GitRemotesSection
              workspacePath={workspacePath}
              remotes={remotes}
              provider={provider}
              onRemotesChanged={() => void loadRemotes()}
              onError={setRemoteError}
            />

            <GitMergeSection
              activeAction={activeAction}
              availableMergeTargets={availableMergeTargets}
              isBusy={isBusy}
              isLoadingOperation={isLoadingOperation}
              mergeTargetBranch={mergeTargetBranch}
              onAbortOperation={() => void handleAbortOperation()}
              onMergeBranch={() => void handleMergeBranch()}
              onSetMergeTargetBranch={setMergeTargetBranch}
              operationState={operationState}
            />

            <GitHistorySection
              diffResult={diffResult}
              history={history}
              isBusy={isBusy}
              isLoadingDiff={isLoadingDiff}
              isLoadingHistory={isLoadingHistory}
              onSelectCommitDiff={(commit) => void handleSelectCommitDiff(commit)}
              onSelectWorkingDiff={(mode) => void handleSelectWorkingDiff(mode)}
              selectedCommit={selectedCommit}
              selectedDiffMode={selectedDiffMode}
              selectedDiffRef={selectedDiffRef}
            />
          </div>
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
      />
      {deleteDialog && (
        <div
          className="git-delete-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={
            deleteDialog.stage === 'force'
              ? `Force delete branch ${deleteDialog.branch}`
              : `Delete branch ${deleteDialog.branch}`
          }
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleteDialogBusy) {
              closeDeleteDialog();
            }
          }}
        >
          <div className="git-delete-dialog">
            <div className="git-delete-dialog-header">
              <p className="git-delete-dialog-title">
                {deleteDialog.stage === 'force' ? 'Force delete branch' : 'Delete branch'}
              </p>
              <span className="git-delete-dialog-branch">{deleteDialog.branch}</span>
            </div>
            <p className="git-delete-dialog-body">
              {deleteDialog.stage === 'force'
                ? `This branch has commits that are not merged into ${currentBranch ?? 'the current branch'}. Deleting it now may permanently discard work.`
                : 'Removing a branch simply deletes the reference; commits remain reachable from other branches or remotes if they exist elsewhere.'}
            </p>
            {deleteDialog.detail && (
              <div className="git-delete-detail">
                <span>Git message</span>
                <p>{deleteDialog.detail}</p>
              </div>
            )}
            <div className="git-delete-actions">
              <button
                type="button"
                className="header-btn git-delete-cancel"
                onClick={closeDeleteDialog}
                disabled={deleteDialogBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`header-btn ${deleteDialog.stage === 'force' ? 'header-btn-danger' : 'header-btn-primary'}`}
                onClick={() => void performDeleteBranch(deleteDialog.stage === 'force')}
                disabled={deleteDialogBusy}
              >
                {deleteDialogBusy && <Loader2 size={13} className="spin" />}
                {deleteDialog.stage === 'force' ? 'Force Delete' : 'Delete branch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
