import { GitBranchesSection } from './GitBranchesSection';
import { GitHistorySection } from './GitHistorySection';
import { GitMenuHeader } from './GitMenuHeader';
import { GitMergeSection } from './GitMergeSection';
import { GitRemoteActionsSection } from './GitRemoteActionsSection';
import GitRemotesSection from './GitRemotesSection';
import { GitStashSection } from './GitStashSection';
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

interface GitRepoMenuProps {
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
  onClose: () => void;
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
}

export function GitRepoMenu({
  activeAction,
  ahead,
  availableMergeTargets,
  behind,
  branchError,
  branches,
  changeCount,
  createBranchInputRef,
  currentBranch,
  currentBranchLabel,
  deepLinks,
  diffError,
  diffResult,
  history,
  historyError,
  includeUntracked,
  isBusy,
  isDetached,
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
  onClose,
  onCreateBranch,
  onDeleteBranch,
  onDropStash,
  onFetch,
  onMergeBranch,
  onOpenCommitDialog,
  onPopStash,
  onPublish,
  onPull,
  onPush,
  onRefresh,
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
  remoteAction,
  remoteError,
  remotes,
  selectedCommit,
  selectedDiffMode,
  selectedDiffRef,
  stashError,
  stashMessage,
  stashes,
  statusErrorMessage,
  upstream,
  upstreamLabel,
  vcsContextError,
  workspacePath,
}: GitRepoMenuProps) {
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
    <div className="git-menu" role="menu" aria-label="Git actions">
      <GitMenuHeader
        ahead={ahead}
        behind={behind}
        changeCount={changeCount}
        currentBranch={currentBranch}
        currentBranchLabel={currentBranchLabel}
        isBusy={isBusy}
        isDetached={isDetached}
        isLoadingBranches={isLoadingBranches}
        isLoadingHistory={isLoadingHistory}
        isLoadingOperation={isLoadingOperation}
        onClose={onClose}
        onOpenCommitDialog={onOpenCommitDialog}
        onRefresh={onRefresh}
        operationState={operationState}
        provider={provider}
        upstream={upstream}
        upstreamLabel={upstreamLabel}
      />

      {errors.map((error) => (
        <div key={error} className="git-menu-error">{error}</div>
      ))}

      {!isDetached && (
        <GitRemoteActionsSection
          currentBranch={currentBranch}
          hasRemotes={remotes.length > 0}
          isBusy={isBusy}
          onFetch={onFetch}
          onPublish={onPublish}
          onPull={onPull}
          onPush={onPush}
          remoteAction={remoteAction}
          upstream={upstream}
        />
      )}

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
      />

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
    </div>
  );
}
