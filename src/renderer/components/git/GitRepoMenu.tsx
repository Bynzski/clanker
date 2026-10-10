import { Button } from '../ui/Button';
import { FormMessage } from '../ui/Field';
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
  branchConfirmationOpen: boolean;
  stashConfirmationOpen?: boolean;
  mergeConfirmationOpen?: boolean;
  isScopeCurrent: () => boolean;
  onWorktreesChanged: () => void;
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
  onApplyStash: (stash: GitStash) => void;
  onClearStashes: () => void;
  onRestoreFocus: () => void;
  onCreateBranch: (event: React.FormEvent) => void;
  onDeleteBranch: (branchName: string) => void;
  onDropStash: (stash: GitStash) => void;
  onFetch: () => void;
  onMergeBranch: () => void;
  onOpenCommitDialog: () => void;
  onPopStash: (stash: GitStash) => void;
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
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const busy = props.isBusy || props.branchConfirmationOpen || props.stashConfirmationOpen || props.mergeConfirmationOpen || worktreeBusy || remoteBusy;
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
  vcsContextError,
  workspacePath,
  workspaceId,
  } = props;

  return (
    <ManagementShell busy={busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}
      onCloseAutoFocus={(event) => { event.preventDefault(); props.onRestoreFocus(); }} title="Source Control"
      items={[
        { id: 'overview', label: 'Overview', group: 'Repository' },
        { id: 'branches', label: 'Branches', group: 'Repository' },
        { id: 'worktrees', label: 'Worktrees', group: 'Repository' },
        { id: 'stashes', label: 'Stashes', group: 'Operations' },
        { id: 'remotes', label: 'Remotes', group: 'Operations' },
        { id: 'merge', label: 'Merge', group: 'Operations' },
        { id: 'tools', label: 'Existing Git Tools', group: 'Advanced — Transitional' },
      ]}
      selectedId={page} onSelect={(id) => { if (!busy) setPage(id); }}>
      {page !== 'overview' && <p className="source-control-location">{props.scope.environmentId === 'local' ? 'Local' : `SSH · ${props.scope.environmentId}`} · {props.scope.path}</p>}
      {page === 'overview' ? <GitOverview {...props} /> : page === 'branches' ? <div className="source-control-page">
      <h2 className="clanker-dialog-title">Branches</h2>
      <p>Local branches of this repository. Switch changes the workspace checkout, not an agent's working directory. Git checks worktree ownership before deletion.</p>
      <p>Current checkout: {props.statusKnown ? props.currentBranchLabel : 'Unknown'}. The current branch cannot be deleted or switched to again.</p>
      <Button disabled={busy || isLoadingBranches} onClick={props.onRefresh}>Refresh branches</Button>
      {branchError && <FormMessage variant="error">{branchError}</FormMessage>}
      <GitBranchesSection
        activeAction={activeAction}
        branches={branches}
        createBranchInputRef={createBranchInputRef}
        currentBranch={currentBranch}
        isBusy={isBusy || isLoadingBranches || !props.statusKnown}
        isLoadingBranches={isLoadingBranches}
        management
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

      </div> : page === 'worktrees' ? <div className="source-control-page">
        <h2 className="clanker-dialog-title">Worktrees</h2>
        <p>Repository-level inspection and cleanup. Main and in-use checkouts are protected; main rechecks agents, terminals and dev servers. Create isolated checkouts through New isolated agent.</p>
        {remoteError && <FormMessage variant="error">{remoteError}</FormMessage>}
        <GitWorktreesSection management workspacePath={workspacePath} workspaceId={workspaceId} refreshKey={refreshKey}
          isScopeCurrent={props.isScopeCurrent} onBusyChange={setWorktreeBusy} onChanged={props.onWorktreesChanged} />
      </div> : page === 'stashes' ? <div className="source-control-page">
        <h2 className="clanker-dialog-title">Stashes</h2>
        <p>Saved changes in this repository. Apply restores changes without removing the stash; Pop restores changes and deletes the stash entry only if Git applies it cleanly.</p>
        <Button disabled={busy || isLoadingStashes} onClick={props.onRefresh}>Refresh stashes</Button>
        {stashError && <FormMessage variant="error">{stashError}</FormMessage>}
        <GitStashSection
          activeAction={activeAction}
          includeUntracked={includeUntracked}
          isBusy={isBusy || isLoadingStashes}
          isLoadingStashes={isLoadingStashes}
          management
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
      </div> : page === 'remotes' ? <div className="source-control-page">
        <h2 className="clanker-dialog-title">Remotes</h2>
        <p>Configured remote repositories. Fetch and push URLs define sync targets for this local repository.</p>
        <Button disabled={busy} onClick={onRemotesChanged}>Refresh remotes</Button>
        {remoteError && <FormMessage variant="error">{remoteError}</FormMessage>}
        <GitRemotesSection
          management
          workspacePath={workspacePath}
          workspaceId={workspaceId}
          remotes={remotes}
          provider={provider}
          onRemotesChanged={onRemotesChanged}
          onError={onSetRemoteError}
          isScopeCurrent={props.isScopeCurrent}
          onBusyChange={setRemoteBusy}
        />
      </div> : page === 'merge' ? <div className="source-control-page">
        <h2 className="clanker-dialog-title">Merge</h2>
        <p>Integrate changes from another branch into your current checkout.</p>
        <p>Current checkout: {props.statusKnown ? props.currentBranchLabel : 'Unknown'}.</p>
        <Button disabled={busy || isLoadingOperation} onClick={props.onRefresh}>Refresh merge state</Button>
        {mergeError && <FormMessage variant="error">{mergeError}</FormMessage>}
        <GitMergeSection
          activeAction={activeAction}
          availableMergeTargets={availableMergeTargets}
          currentBranch={currentBranch}
          isBusy={isBusy || isLoadingOperation}
          isDetached={isDetached}
          isLoadingOperation={isLoadingOperation}
          management
          mergeTargetBranch={mergeTargetBranch}
          onAbortOperation={onAbortOperation}
          onMergeBranch={onMergeBranch}
          onSetMergeTargetBranch={onSetMergeTargetBranch}
          operationState={operationState}
        />
      </div> : <div className="git-tools-content">
      <h2 className="clanker-dialog-title">Existing Git Tools</h2>
      <p>History and Diff retain their existing implementations pending later migration.</p>
      {[historyError, diffError].filter((err): err is string => Boolean(err)).map((error) => (
        <div key={error} className="git-menu-error">{error}</div>
      ))}
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
