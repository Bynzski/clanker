import { Button } from '../ui/Button';
import { FormMessage } from '../ui/Field';
import { GitBranchesSection } from './GitBranchesSection';
import { GitHistorySection } from './GitHistorySection';
import { useState } from 'react';
import { ManagementShell } from '../ui/ManagementShell';
import { GitOverview } from './GitOverview';
import { GitResourceNotice } from './GitResourceNotice';
import type { GitMenuPage, useGitMenuResources } from './useGitMenuResources';
import { GitChanges } from './GitChanges';
import type { useCommitComposer } from './useCommitComposer';
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
  GitStatus,
  VcsProvider,
} from './types';
import type { PullRequestContext, DeepLink, ProviderContext } from '../../store/vcsStore';
import type { CiSummary, ReviewSummary } from '../../../shared/types/vcs';

export interface GitRepoMenuProps {
  page?: GitMenuPage;
  onSelectPage?: (page: GitMenuPage) => void;
  resources?: ReturnType<typeof useGitMenuResources>;
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
  changes: GitStatus[];
  changesError: string | null;
  isLoadingChanges: boolean;
  reviewRevision: number;
  onRefreshChanges: () => Promise<void>;
  onStageFile: (path: string) => Promise<{ success: boolean; error?: string }>;
  onStageAll: () => Promise<{ success: boolean; error?: string }>;
  onUnstageFile: (path: string) => Promise<{ success: boolean; error?: string }>;
  onUnstageAll: () => Promise<{ success: boolean; error?: string }>;
  createBranchInputRef: React.RefObject<HTMLInputElement | null>;
  currentBranch: string | null;
  currentBranchLabel: string;
  deepLinks: DeepLink[];
  diffError: string | null;
  diffResult: GitDiffResult | null;
  hasMoreHistory?: boolean;
  historyLimit?: number;
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
  onLoadMoreHistory?: () => void;
  onRestoreFocus: () => void;
  onCreateBranch: (event: React.FormEvent) => void;
  onDeleteBranch: (branchName: string) => void;
  onDropStash: (stash: GitStash) => void;
  onFetch: () => void;
  onMergeBranch: () => void;
  commitComposer: ReturnType<typeof useCommitComposer>;
  commitProgress: string | null;
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
  ci?: CiSummary;
  review?: ReviewSummary;
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
  const [localPage, setLocalPage] = useState<GitMenuPage>('changes');
  const page = props.page ?? localPage;
  const setPage = (page: GitMenuPage) => { setLocalPage(page); props.onSelectPage?.(page); };
  const notices = (names: Array<'branch' | 'operation' | 'history' | 'stash' | 'remote' | 'provider'>) => props.resources
    ? names.map(name => <GitResourceNotice key={name} name={name} resource={props.resources![name]} onRetry={() => {
      const r = props.resources!;
      if (name === 'branch') void r.readBranches(true);
      if (name === 'operation') void r.readOperation(true);
      if (name === 'history') void r.readHistory(true, props.historyLimit ?? 10);
      if (name === 'stash') void r.readStashes(true);
      if (name === 'remote') void r.readRemotes(true);
      if (name === 'provider') void r.readProvider(true);
    }} />) : null;
  const unavailable = (name: 'branch' | 'operation' | 'stash' | 'remote') => props.resources ? props.resources[name].phase !== 'ready' : false;
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

  const checkoutContext = <p className="source-control-location">{props.scope.environmentId === 'local' ? 'Local' : `SSH · ${props.scope.environmentId}`} · {props.scope.path}<br />
    {props.scope.checkoutLabel} · <span>Current branch: {props.statusKnown ? props.currentBranchLabel : 'Unknown branch'}</span></p>;

  return (
    <ManagementShell busy={busy} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}
      onCloseAutoFocus={(event) => { event.preventDefault(); props.onRestoreFocus(); }} title="Source Control"
      items={[
        { id: 'changes', label: 'Changes', group: 'Repository' },
        { id: 'history', label: 'History', group: 'Repository' },
        { id: 'overview', label: 'Overview', group: 'Repository' },
        { id: 'branches', label: 'Branches', group: 'Repository' },
        { id: 'worktrees', label: 'Worktrees', group: 'Repository' },
        { id: 'stashes', label: 'Stashes', group: 'Operations' },
        { id: 'remotes', label: 'Remotes', group: 'Operations' },
        { id: 'merge', label: 'Merge', group: 'Operations' },
      ]}
      selectedId={page} onSelect={(id) => { if (!busy) setPage(id as GitMenuPage); }}>
      {!props.statusKnown && page !== 'changes' && <div role="alert">Current Git status unavailable. Operations are disabled. <Button disabled={props.isBusy || props.isLoadingChanges} onClick={() => void props.onRefreshChanges()}>Refresh changes</Button></div>}
      {page === 'changes' ? <GitChanges {...props} /> : page === 'overview' ? <GitOverview {...props} onReviewChanges={() => { if (!busy) setPage('changes'); }} /> : page === 'branches' ? <div className="source-control-page">
      <div className="source-control-page-heading"><h2 className="clanker-dialog-title">Branches</h2>
        <Button size="xs" disabled={busy} onClick={props.onRefresh}>Refresh branches</Button></div>
      {checkoutContext}
      <p>Switch or create a branch in the selected checkout. Branches checked out elsewhere are protected by Git; the current branch cannot be deleted.</p>
      {notices(['branch', 'provider'])}
      {providerContext && props.resources && props.resources.provider.phase !== 'ready' && <p>Provider (last known / partial): {providerContext.owner}/{providerContext.repo}</p>}
      {branchError && <FormMessage variant="error">{branchError}</FormMessage>}
      <GitBranchesSection
        emptyMessage={unavailable('branch') ? 'Branches unavailable' : undefined}
        activeAction={activeAction}
        branches={branches}
        createBranchInputRef={createBranchInputRef}
        currentBranch={currentBranch}
        isBusy={isBusy || isLoadingBranches || unavailable('branch') || !props.statusKnown}
        isLoadingBranches={isLoadingBranches}
        management
        newBranchName={newBranchName}
        onCreateBranch={onCreateBranch}
        onDeleteBranch={onDeleteBranch}
        onSetNewBranchName={onSetNewBranchName}
        onSwitchBranch={onSwitchBranch}
        provider={!props.resources || props.resources.provider.phase === 'ready' ? providerContext : null}
        pullRequest={pullRequest}
        deepLinks={deepLinks}
        isLoadingContext={isLoadingContext}
        contextError={props.resources ? null : vcsContextError}
        onRefreshContext={onRefreshContext}
        workspacePath={workspacePath}
        workspaceId={workspaceId}
      />

      </div> : page === 'worktrees' ? <div className="source-control-page">
        <h2 className="clanker-dialog-title">Worktrees</h2>
        {checkoutContext}
        <p>Main and in-use checkouts are protected. Worktrees persist until you explicitly remove them.</p>
        {remoteError && <FormMessage variant="error">{remoteError}</FormMessage>}
        <GitWorktreesSection management workspacePath={workspacePath} workspaceId={workspaceId} refreshKey={refreshKey}
          isScopeCurrent={props.isScopeCurrent} onBusyChange={setWorktreeBusy} onChanged={props.onWorktreesChanged} />
      </div> : page === 'stashes' ? <div className="source-control-page">
        <div className="source-control-page-heading"><h2 className="clanker-dialog-title">Stashes</h2>
          <Button size="xs" disabled={busy} onClick={props.onRefresh}>Refresh stashes</Button></div>
        {checkoutContext}
        <p>Apply keeps the stash; Pop removes it only after Git applies it cleanly.</p>
        {notices(['stash'])}
        {stashError && <FormMessage variant="error">{stashError}</FormMessage>}
        <GitStashSection
          emptyMessage={unavailable('stash') ? 'Stashes unavailable' : undefined}
          activeAction={activeAction}
          includeUntracked={includeUntracked}
          isBusy={isBusy || isLoadingStashes || unavailable('stash') || !props.statusKnown}
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
        <div className="source-control-page-heading"><h2 className="clanker-dialog-title">Remotes</h2>
          <Button size="xs" disabled={busy} onClick={props.onRefresh}>Refresh remotes</Button></div>
        {checkoutContext}
        <p>Remote configuration is shared by all checkouts of this repository.</p>
        {remoteError && <FormMessage variant="error">{remoteError}</FormMessage>}
        {notices(['remote'])}
        <fieldset disabled={!props.statusKnown || unavailable('remote')} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <GitRemotesSection
          emptyMessage={unavailable('remote') ? 'Remote configuration unavailable' : undefined}
          management
          workspacePath={workspacePath}
          workspaceId={workspaceId}
          remotes={remotes}
          provider={provider}
          onRemotesChanged={onRemotesChanged}
          onError={onSetRemoteError}
          isScopeCurrent={props.isScopeCurrent}
          onBusyChange={setRemoteBusy}
        /></fieldset>
      </div> : page === 'merge' ? <div className="source-control-page">
        <div className="source-control-page-heading"><h2 className="clanker-dialog-title">Merge</h2>
          <Button size="xs" disabled={busy} onClick={props.onRefresh}>Refresh merge state</Button></div>
        {checkoutContext}
        <p>Integrate another branch into the selected checkout.</p>
        {notices(['operation', 'branch'])}
        {mergeError && <FormMessage variant="error">{mergeError}</FormMessage>}
        <GitMergeSection
          activeAction={activeAction}
          availableMergeTargets={availableMergeTargets}
          currentBranch={currentBranch}
          isBusy={isBusy || isLoadingOperation || unavailable('operation') || unavailable('branch') || !props.statusKnown}
          isDetached={isDetached}
          isLoadingOperation={isLoadingOperation}
          management
          mergeTargetBranch={mergeTargetBranch}
          onAbortOperation={onAbortOperation}
          onMergeBranch={onMergeBranch}
          onSetMergeTargetBranch={onSetMergeTargetBranch}
          operationState={operationState}
        />
      </div> : <div className="source-control-page source-control-history">
        <div className="source-control-page-heading"><h2 className="clanker-dialog-title">History</h2>
          <Button size="xs" disabled={busy} onClick={props.onRefresh}>Refresh history</Button></div>
        {checkoutContext}
        {notices(['history'])}
        {!props.resources && historyError && <FormMessage variant="error">{historyError}</FormMessage>}
        <GitHistorySection
          emptyMessage={props.resources?.history.phase === 'error' ? 'History unavailable' : undefined}
          management
          diffError={diffError}
          diffResult={diffResult}
          history={history}
          isBusy={isBusy}
          isLoadingDiff={isLoadingDiff}
          isLoadingHistory={isLoadingHistory}
          hasMoreHistory={props.hasMoreHistory}
          onLoadMoreHistory={props.onLoadMoreHistory}
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
