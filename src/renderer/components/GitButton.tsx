import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  GitBranch as GitBranchIcon,
  RefreshCw,
  X,
} from 'lucide-react';
import CommitDialog from './CommitDialog';
import { GitBranchesSection } from './git/GitBranchesSection';
import { GitHistorySection } from './git/GitHistorySection';
import { GitMergeSection } from './git/GitMergeSection';
import { GitStashSection } from './git/GitStashSection';
import type {
  DiffMode,
  GitBranch,
  GitDiffResult,
  GitHistoryEntry,
  GitOperationState,
  GitStashEntry,
  GitStatus,
} from './git/types';
import './GitButton.css';

interface GitButtonProps {
  workspacePath: string;
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
  const [newBranchName, setNewBranchName] = useState('');
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [operationState, setOperationState] = useState<GitOperationState | null>(null);
  const [isLoadingOperation, setIsLoadingOperation] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeTargetBranch, setMergeTargetBranch] = useState('');
  const [stashMessage, setStashMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
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
  }, [selectedDiffMode, selectedDiffRef, workspacePath]);

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
      setBranches([]);
      setOperationState(null);
      setStashes([]);
      setHistory([]);
      setIsMenuOpen(false);
      setIsDialogOpen(false);
      return;
    }

    window.electronAPI.gitStartPolling(workspacePath);

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
      } else {
        setIsRepo(false);
        setChangeCount(0);
        setChanges([]);
        setCurrentBranch(null);
        setIsDetached(false);
        setStatusErrorCode(status.errorCode ?? null);
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

  const handleDeleteBranch = async (branchName: string) => {
    const confirmed = window.confirm(`Delete branch "${branchName}"?`);
    if (!confirmed) {
      return;
    }

    setActiveAction(`delete:${branchName}`);
    setBranchError(null);

    try {
      const result = await window.electronAPI.gitDeleteBranch(workspacePath, branchName);
      if (result.success) {
        await refreshAfterAction();
      } else {
        setBranchError(result.error || 'Failed to delete branch');
      }
    } catch (error: any) {
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
              </div>

              <button
                type="button"
                className="git-menu-close"
                onClick={() => setIsMenuOpen(false)}
                title="Close"
              >
                <X size={15} />
              </button>
            </div>

            <div className="git-menu-summary">
              <span>{changeCount} changed</span>
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
        changes={changes}
        workspacePath={workspacePath}
      />
    </>
  );
}
