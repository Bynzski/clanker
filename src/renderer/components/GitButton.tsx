import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import CommitDialog from './CommitDialog';
import './GitButton.css';

interface GitStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
}

interface GitOperationState {
  success: boolean;
  isRepo: boolean;
  inProgress: boolean;
  mode: 'none' | 'merge' | 'rebase';
  conflicts: string[];
  message: string;
  error?: string;
}

interface GitStashEntry {
  hash: string;
  ref: string;
  message: string;
}

interface GitHistoryEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

interface GitDiffResult {
  success: boolean;
  output: string;
  title: string;
  error?: string;
}

interface BranchState {
  success: boolean;
  isRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  branches: GitBranchInfo[];
  error?: string;
}

interface GitButtonProps {
  workspacePath: string;
}

type DiffMode = 'working' | 'staged' | 'commit';

export default function GitButton({ workspacePath }: GitButtonProps) {
  const [changeCount, setChangeCount] = useState(0);
  const [isRepo, setIsRepo] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [changes, setChanges] = useState<GitStatus[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [isDetached, setIsDetached] = useState(false);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
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

  const refreshMenuData = async () => {
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
  };

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
      } else {
        setIsRepo(false);
        setChangeCount(0);
        setChanges([]);
        setCurrentBranch(null);
        setIsDetached(false);
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
  }, [isMenuOpen]);

  const refreshAfterAction = async () => {
    await Promise.all([refreshMenuData(), window.electronAPI.gitRefresh()]);
  };

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
          <GitBranch size={15} strokeWidth={2} />
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

            <div className="git-menu-section">
              <div className="git-menu-section-header">Create Branch</div>
              <form className="git-create-branch-form" onSubmit={handleCreateBranch}>
                <input
                  ref={createBranchInputRef}
                  className="git-create-branch-input"
                  value={newBranchName}
                  onChange={(event) => setNewBranchName(event.target.value)}
                  placeholder={currentBranch ? `From ${currentBranch}` : 'Branch name'}
                  disabled={isBusy}
                />
                <button
                  type="submit"
                  className="header-btn git-create-branch-submit"
                  disabled={isBusy || newBranchName.trim().length === 0}
                >
                  {activeAction === 'create' ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
                  Create
                </button>
              </form>
            </div>

            <div className="git-menu-section">
              <div className="git-menu-section-header">
                Branches
                <span className="git-menu-count">{branches.length}</span>
              </div>

              {isLoadingBranches ? (
                <div className="git-menu-empty">Loading branches...</div>
              ) : branches.length === 0 ? (
                <div className="git-menu-empty">No local branches found</div>
              ) : (
                <div className="git-branch-list">
                  {branches.map((branch) => (
                    <div
                      key={branch.name}
                      className={`git-branch-item ${branch.isCurrent ? 'current' : ''}`}
                    >
                      <div className="git-branch-name">
                        <span>{branch.name}</span>
                        {branch.isCurrent && <span className="git-branch-current">Current</span>}
                      </div>
                      <div className="git-branch-actions">
                        <button
                          type="button"
                          className="git-branch-action"
                          onClick={() => void handleSwitchBranch(branch.name)}
                          disabled={branch.isCurrent || isBusy}
                        >
                          {activeAction === `switch:${branch.name}` ? (
                            <Loader2 size={12} className="spin" />
                          ) : null}
                          Switch
                        </button>
                        <button
                          type="button"
                          className="git-branch-action danger"
                          onClick={() => void handleDeleteBranch(branch.name)}
                          disabled={branch.isCurrent || isBusy}
                        >
                          {activeAction === `delete:${branch.name}` ? (
                            <Loader2 size={12} className="spin" />
                          ) : (
                            <Trash2 size={12} />
                          )}
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="git-menu-section">
              <div className="git-menu-section-header">
                Stash
                <span className="git-menu-count">{stashes.length}</span>
              </div>

              <div className="git-stash-form">
                <input
                  className="git-stash-input"
                  value={stashMessage}
                  onChange={(event) => setStashMessage(event.target.value)}
                  placeholder="Optional stash message"
                  disabled={isBusy}
                />
                <label className="git-stash-toggle">
                  <input
                    type="checkbox"
                    checked={includeUntracked}
                    onChange={(event) => setIncludeUntracked(event.target.checked)}
                    disabled={isBusy}
                  />
                  <span>Untracked</span>
                </label>
                <button
                  type="button"
                  className="header-btn git-create-branch-submit"
                  onClick={() => void handleStash()}
                  disabled={isBusy}
                >
                  {activeAction === 'stash' ? <Loader2 size={13} className="spin" /> : null}
                  Stash
                </button>
              </div>

              <div className="git-stash-toolbar">
                <span>{stashes.length > 0 ? 'Available stashes' : 'No stashes found'}</span>
                {stashes.length > 0 && (
                  <button
                    type="button"
                    className="git-stash-clear"
                    onClick={() => void handleClearStashes()}
                    disabled={isBusy}
                  >
                    Clear All
                  </button>
                )}
              </div>

              {isLoadingStashes ? (
                <div className="git-menu-empty">Loading stashes...</div>
              ) : stashes.length === 0 ? (
                <div className="git-menu-empty">Nothing stashed yet</div>
              ) : (
                <div className="git-stash-list">
                  {stashes.map((stash) => (
                    <div key={stash.ref} className="git-stash-item">
                      <div className="git-stash-meta">
                        <span className="git-stash-ref">{stash.ref}</span>
                        <span className="git-stash-message">{stash.message}</span>
                      </div>
                      <div className="git-stash-actions">
                        <button
                          type="button"
                          className="git-branch-action"
                          onClick={() => void handleApplyStash(stash.ref)}
                          disabled={isBusy}
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          className="git-branch-action"
                          onClick={() => void handlePopStash(stash.ref)}
                          disabled={isBusy}
                        >
                          Pop
                        </button>
                        <button
                          type="button"
                          className="git-branch-action danger"
                          onClick={() => void handleDropStash(stash.ref)}
                          disabled={isBusy}
                        >
                          Drop
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="git-menu-section">
              <div className="git-menu-section-header">
                Merge
                {operationState?.inProgress ? (
                  <span className="git-menu-count">Active</span>
                ) : (
                  <span className="git-menu-count">{availableMergeTargets.length}</span>
                )}
              </div>

              {isLoadingOperation ? (
                <div className="git-menu-empty">Checking merge state...</div>
              ) : operationState?.inProgress ? (
                <div className="git-operation-panel">
                  <div className={`git-operation-status ${operationState.mode}`}>
                    {operationState.message}
                  </div>
                  {operationState.conflicts.length > 0 && (
                    <div className="git-conflict-list">
                      {operationState.conflicts.map((file) => (
                        <span key={file} className="git-conflict-file">
                          {file}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="git-operation-abort"
                    onClick={() => void handleAbortOperation()}
                    disabled={isBusy}
                  >
                    Abort {operationState.mode === 'rebase' ? 'Rebase' : 'Merge'}
                  </button>
                </div>
              ) : (
                <div className="git-merge-form">
                  <select
                    className="git-merge-select"
                    value={mergeTargetBranch}
                    onChange={(event) => setMergeTargetBranch(event.target.value)}
                    disabled={isBusy || availableMergeTargets.length === 0}
                  >
                    {availableMergeTargets.length === 0 ? (
                      <option value="">No branches available</option>
                    ) : (
                      availableMergeTargets.map((branch) => (
                        <option key={branch} value={branch}>
                          {branch}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    className="header-btn git-create-branch-submit"
                    onClick={() => void handleMergeBranch()}
                    disabled={isBusy || !mergeTargetBranch}
                  >
                    {activeAction?.startsWith('merge:') ? <Loader2 size={13} className="spin" /> : null}
                    Merge
                  </button>
                </div>
              )}
            </div>

            <div className="git-menu-section">
              <div className="git-menu-section-header">
                History
                <span className="git-menu-count">{history.length}</span>
              </div>

              <div className="git-history-toolbar">
                <button
                  type="button"
                  className={`git-history-toggle ${selectedDiffMode === 'working' ? 'active' : ''}`}
                  onClick={() => void handleSelectWorkingDiff('working')}
                  disabled={isBusy}
                >
                  Working Tree
                </button>
                <button
                  type="button"
                  className={`git-history-toggle ${selectedDiffMode === 'staged' ? 'active' : ''}`}
                  onClick={() => void handleSelectWorkingDiff('staged')}
                  disabled={isBusy}
                >
                  Staged
                </button>
              </div>

              {isLoadingHistory ? (
                <div className="git-menu-empty">Loading history...</div>
              ) : history.length === 0 ? (
                <div className="git-menu-empty">No commits found</div>
              ) : (
                <div className="git-history-list">
                  {history.map((entry) => (
                    <button
                      key={entry.hash}
                      type="button"
                      className={`git-history-item ${
                        selectedDiffMode === 'commit' && selectedDiffRef === entry.hash ? 'active' : ''
                      }`}
                      onClick={() => void handleSelectCommitDiff(entry)}
                      disabled={isBusy}
                    >
                      <div className="git-history-line">
                        <span className="git-history-hash">{entry.shortHash}</span>
                        <span className="git-history-subject">{entry.subject}</span>
                      </div>
                      <div className="git-history-meta">
                        <span>{entry.author}</span>
                        <span>{entry.date}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="git-diff-panel">
                <div className="git-diff-header">
                  <div className="git-diff-title">
                    {diffResult?.title || 'Diff'}
                    {selectedCommit ? (
                      <span className="git-diff-subtitle">{selectedCommit.shortHash}</span>
                    ) : null}
                  </div>
                  {isLoadingDiff && <Loader2 size={13} className="spin" />}
                </div>
                <pre className="git-diff-output">
                  {diffResult?.output || 'No diff to display'}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>

      <CommitDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onCommit={handleCommit}
        onStageAll={handleStage}
        changes={changes}
      />
    </>
  );
}
