import { GitBranchesSection } from './GitBranchesSection';
import { GitHistorySection } from './GitHistorySection';
import { useState } from 'react';
import { ManagementShell } from '../ui/ManagementShell';
import { GitOverview } from './GitOverview';
import type { gitManagementScope } from './gitManagementScope';
import { GitMergeSection } from './GitMergeSection';
import GitRemotesSection from './GitRemotesSection';
import { GitStashSection } from './GitStashSection';
import { GitWorktreesSection } from './GitWorktreesSection';
import type {
  DiffMode,
  GitBranch,
  GitDiffResult,
  GitHistoryEntry,
  GitOperationState,
  GitRemote,
  GitStash,
  VcsProvider,
} from './types';
import type { PullRequestContext, DeepLink, ProviderContext } from '../../store/vcsStore';

export interface GitRepoMenuProps {
  scope: ReturnType<typeof gitManagementScope>;
  statusKnown: boolean;
  activeAction: string | null;
  ahead: number;
  availableMergeTargets: string[];
  behind: number;
  branchError: string | null;
  branches: GitBranch[];
  changeCount: number;
  createBranchInputRef: React.RefObject<HTMLInputElement | null>;
  currentBranch: string | null;
  currentBranchLabel: string;
  deepLinks: DeepLink[];
  diffError: string | null;
  diffResult: GitDiffResult | null;
  history: GitHistoryEntry[];
  historyError: string | null;
  includeUntracked: boolean;
  isBusy: boolean;
  isDetached: boolean;
  isLoadingBranches: boolean;
  isLoadingContext: boolean;
  isLoadingDiff: boolean;
  isLoadingHistory: boolean;
  isLoadingOperation: boolean;
  isLoadingStashes: boolean;
  mergeError: string | null;
  mergeTargetBranch: string;
  newBranchName: string;
  onAbortOperation: () => void;
  onApplyStash: (stashRef: string) => void;
  onClearStashes: () => void;
  onRestoreFocus: () => void;
  onCreateBranch: (event: React.FormEvent) => void;
  onDeleteBranch: (branchName: string) => void;
  onDropStash: (stashRef: string) => void;
  onFetch: () => void;
  onMergeBranch: () => void;
  onOpenCommitDialog: () => void;
  onPopStash: (stashRef: string) => void;
  onPublish: () => void;
  onPull: () => void;
  onPush: () => void;
  onRefresh: () => void;
  onRefreshContext: () => void;
  onRemotesChanged: () => void;
  onSelectCommitDiff: (commit: GitHistoryEntry) => void;
  onSelectWorkingDiff: (mode: DiffMode) => void;
  onSetIncludeUntracked: (value: boolean) => void;
  onSetMergeTargetBranch: (value: string) => void;
  onSetNewBranchName: (value: string) => void;
  onSetRemoteError: (error: string | null) => void;
  onSetStashMessage: (value: string) => void;
  onStash: () => void;
  onSwitchBranch: (branchName: string) => void;
  operationState: GitOperationState | null;
  provider: VcsProvider;
  providerContext: ProviderContext | null;
  pullRequest: PullRequestContext | null;
  /** Bumped by the menu's data refresh; the Worktrees section reloads with it. */
  refreshKey?: number;
  remoteAction: 'fetch' | 'pull' | 'push' | 'publish' | null;
  remoteError: string | null;
  remotes: GitRemote[];
  selectedCommit: GitHistoryEntry | null;
  selectedDiffMode: DiffMode;
  selectedDiffRef: string | null;
  stashError: string | null;
  stashMessage: string;
  stashes: GitStash[];
  statusErrorMessage: string | null;
  upstream: string | null;
  upstreamLabel: string | null;
  vcsContextError: string | null;
  workspacePath: string;
  workspaceId?: string;
}

export function GitRepoMenu(props: GitRepoMenuProps) {
  const [page, setPage] = useState('overview');
  const {
  activeAction,
  availableMergeTargets,
  branchError,
  branches,
  createBranchInputRef,
  currentBranch,
  deepLinks,
  diffError,
  diffResult,
  history,
  historyError,
  includeUntracked,
  isBusy,
  isLoadingBranches,
  isLoadingContext,
  isLoadingDiff,
  isLoadingHistory,
  isLoadingOperation,
  isLoadingStashes,
  mergeError,
  mergeTargetBranch,
  newBranchName,
  onAbortOperation,
  onApplyStash,
  onClearStashes,
  onCreateBranch,
  onDeleteBranch,
  onDropStash,
  onMergeBranch,
  onPopStash,
  onRefreshContext,
  onRemotesChanged,
  onSelectCommitDiff,
  onSelectWorkingDiff,
  onSetIncludeUntracked,
  onSetMergeTargetBranch,
  onSetNewBranchName,
  onSetRemoteError,
  onSetStashMessage,
  onStash,
  onSwitchBranch,
  operationState,
  provider,
  providerContext,
  pullRequest,
  refreshKey = 0,
  remoteError,
  remotes,
  selectedCommit,
  selectedDiffMode,
  selectedDiffRef,
  stashError,
  stashMessage,
  stashes,
  statusErrorMessage,
  vcsContextError,
  workspacePath,
  workspaceId,
  } = props;
  const errors = [
    statusErrorMessage,
    branchError,
    mergeError,
    stashError,
    historyError,
    diffError,
    remoteError,
  ].filter((error): error is string => Boolean(error));

  return (
    <ManagementShell onCloseAutoFocus={(event) => { event.preventDefault(); props.onRestoreFocus(); }} title="Source Control" items={[{ id: 'overview', label: 'Overview', group: 'Repository' }, { id: 'tools', label: 'Existing Git Tools', group: 'Advanced (transitional)' }]} selectedId={page} onSelect={setPage}>
      {page !== 'overview' && <p className="source-control-location">{props.scope.environmentId === 'local' ? 'Local' : `SSH · ${props.scope.environmentId}`} · {props.scope.path}</p>}
      {page === 'overview' ? <GitOverview {...props} /> : <div className="git-tools-content">
      <h2 className="clanker-dialog-title">Existing Git Tools</h2>
      <p>Branches, Worktrees, Stashes, Remotes, Merge and History use their existing implementations during migration.</p>
      {errors.map((error) => (
        <div key={error} className="git-menu-error">{error}</div>
      ))}

      <GitBranchesSection
        activeAction={activeAction}
        branches={branches}
        createBranchInputRef={createBranchInputRef}
        currentBranch={currentBranch}
        isBusy={isBusy}
        isLoadingBranches={isLoadingBranches}
        newBranchName={newBranchName}
        onCreateBranch={onCreateBranch}
        onDeleteBranch={onDeleteBranch}
        onSetNewBranchName={onSetNewBranchName}
        onSwitchBranch={onSwitchBranch}
        provider={providerContext}
        pullRequest={pullRequest}
        deepLinks={deepLinks}
        isLoadingContext={isLoadingContext}
        contextError={vcsContextError}
        onRefreshContext={onRefreshContext}
        workspacePath={workspacePath}
        workspaceId={workspaceId}
      />

      <GitWorktreesSection workspacePath={workspacePath} workspaceId={workspaceId} refreshKey={refreshKey} />

      <GitStashSection
        activeAction={activeAction}
        includeUntracked={includeUntracked}
        isBusy={isBusy}
        isLoadingStashes={isLoadingStashes}
        onApplyStash={onApplyStash}
        onClearStashes={onClearStashes}
        onDropStash={onDropStash}
        onPopStash={onPopStash}
        onSetIncludeUntracked={onSetIncludeUntracked}
        onSetStashMessage={onSetStashMessage}
        onStash={onStash}
        stashMessage={stashMessage}
        stashes={stashes}
      />

      <GitRemotesSection
        workspacePath={workspacePath}
        workspaceId={workspaceId}
        remotes={remotes}
        provider={provider}
        onRemotesChanged={onRemotesChanged}
        onError={onSetRemoteError}
      />

      <GitMergeSection
        activeAction={activeAction}
        availableMergeTargets={availableMergeTargets}
        isBusy={isBusy}
        isLoadingOperation={isLoadingOperation}
        mergeTargetBranch={mergeTargetBranch}
        onAbortOperation={onAbortOperation}
        onMergeBranch={onMergeBranch}
        onSetMergeTargetBranch={onSetMergeTargetBranch}
        operationState={operationState}
      />

      <GitHistorySection
        diffResult={diffResult}
        history={history}
        isBusy={isBusy}
        isLoadingDiff={isLoadingDiff}
        isLoadingHistory={isLoadingHistory}
        onSelectCommitDiff={onSelectCommitDiff}
        onSelectWorkingDiff={onSelectWorkingDiff}
        selectedCommit={selectedCommit}
        selectedDiffMode={selectedDiffMode}
        selectedDiffRef={selectedDiffRef}
      />
      </div>}
    </ManagementShell>
  );
}
