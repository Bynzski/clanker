import { useState } from 'react';
import { Select } from '../ui/Select';
import type { GitWorktree } from '../../../shared/types/git';
import { Button } from '../ui/Button';
import { currentVcsCheckoutId } from '../../lib/vcsCheckout';
import { Input } from '../ui/Input';
import { FieldLabel, FormMessage } from '../ui/Field';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { GitBranch } from './types';
import type { PullRequestContext, DeepLink, ProviderContext } from '../../store/vcsStore';
import ProviderBadge from './ProviderBadge';
import ProviderMenu from './ProviderMenu';
import './GitBranchesSection.css';

interface GitBranchesSectionProps {
  management?: boolean;
  worktrees?: readonly GitWorktree[];
  workingFolderPath?: string;
  onViewWorktree?: (worktree: GitWorktree) => void;
  emptyMessage?: string;
  activeAction: string | null;
  branches: GitBranch[];
  createBranchInputRef: React.RefObject<HTMLInputElement | null>;
  currentBranch: string | null;
  isBusy: boolean;
  isLoadingBranches: boolean;
  newBranchName: string;
  onCreateBranch: (event: React.FormEvent, baseBranch?: string) => void;
  onDeleteBranch: (branchName: string) => void;
  onSetNewBranchName: (value: string) => void;
  onSwitchBranch: (branchName: string) => void;
  // Provider context
  provider: ProviderContext | null;
  pullRequest: PullRequestContext | null;
  deepLinks: DeepLink[];
  isLoadingContext: boolean;
  contextError: string | null;
  onRefreshContext: () => void;
  workspacePath: string;
  workspaceId?: string;
}

export function GitBranchesSection({
  management = false,
  worktrees = [],
  workingFolderPath,
  onViewWorktree,
  emptyMessage = 'No local branches found',
  activeAction,
  branches,
  createBranchInputRef,
  currentBranch,
  isBusy,
  isLoadingBranches,
  newBranchName,
  onCreateBranch,
  onDeleteBranch,
  onSetNewBranchName,
  onSwitchBranch,
  provider,
  pullRequest,
  deepLinks,
  isLoadingContext,
  contextError,
  onRefreshContext,
  workspacePath,
  workspaceId,
}: GitBranchesSectionProps) {
  const [baseBranch, setBaseBranch] = useState('');
  // Handle opening PR in browser
  const handleViewPr = () => {
    if (pullRequest?.url) {
      window.electronAPI.openExternal(pullRequest.url);
    }
  };

  // Handle creating PR
  const handleCreatePr = () => {
    const checkoutContextId = currentVcsCheckoutId(workspaceId);
    if (checkoutContextId === null) return;
    if (checkoutContextId) window.electronAPI.vcsOpenDeepLink(workspacePath, 'create-pr', workspaceId, { checkoutContextId });
    else window.electronAPI.vcsOpenDeepLink(workspacePath, 'create-pr', workspaceId);
  };

  // Get provider name for badge
  const providerName = provider?.provider === 'github'
    ? 'GitHub'
    : provider?.provider === 'gitlab'
      ? 'GitLab'
      : provider?.provider === 'bitbucket'
        ? 'Bitbucket'
        : 'GitHub';

  return (
    <>
      {/* Provider context header with menu */}
      {provider && (
        <div className="git-menu-section provider-context-header">
          <div className="provider-context-info">
            <span className="provider-context-repo">
              {provider.owner}/{provider.repo}
            </span>
            <ProviderBadge
              pullRequest={isLoadingContext || contextError && !['found', 'none'].includes(pullRequest?.outcome ?? '') ? null : pullRequest}
              providerName={providerName}
              onViewPr={handleViewPr}
              onCreatePr={handleCreatePr}
            />
          </div>
          <ProviderMenu
            provider={provider}
            deepLinks={deepLinks}
            isLoading={isLoadingContext}
            error={contextError}
            onRefresh={onRefreshContext}
            workspacePath={workspacePath}
            workspaceId={workspaceId}
          />
        </div>
      )}

      {!provider && contextError && <FormMessage variant="error">{contextError}</FormMessage>}
      <div className="git-menu-section">
        <FieldLabel htmlFor="source-control-branch-name">Create and switch branch</FieldLabel>
        <p className="git-branch-note">Uses this folder, not a new worktree. Switching changes files for every session using this folder.</p>
        <form
          className="git-create-branch-form"
          onSubmit={(event) => {
            event.preventDefault();
            onCreateBranch(event, baseBranch ? `refs/heads/${baseBranch}` : undefined);
          }}
        >
          <Input variant="mono" id="source-control-branch-name"
            ref={createBranchInputRef}
            className="git-create-branch-input"
            value={newBranchName}
            onChange={(event) => onSetNewBranchName(event.target.value)}
            placeholder={currentBranch ? `From ${currentBranch}` : 'Branch name'}
            disabled={isBusy}
          />
          <div className="git-branch-base">
            <FieldLabel htmlFor="source-control-branch-base">Start from</FieldLabel>
            <Select id="source-control-branch-base" value={baseBranch} disabled={isBusy} onChange={(event) => setBaseBranch(event.target.value)}>
              <option value="">Current commit{currentBranch ? ` · ${currentBranch}` : ''}</option>
              {branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
            </Select>
          </div>
          <Button
            size="xs"
            type="submit"
            className="header-btn git-create-branch-submit"
            disabled={isBusy || newBranchName.trim().length === 0}
          >
            {activeAction === 'create' ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
            Create and switch
          </Button>
        </form>
      </div>

      <div className="git-menu-section">
        <div className="git-menu-section-header">
          {management ? 'Local branches' : 'Branches'}
          <span className="git-menu-count">{branches.length}</span>
        </div>

        {isLoadingBranches && !branches.length ? (
          <div className="git-menu-empty">Loading branches…</div>
        ) : branches.length === 0 ? (
          <div className="git-menu-empty">{emptyMessage}</div>
        ) : (
          <div className={`git-branch-list${management ? ' source-control-branch-list' : ''}`}>
            {branches.map((listedBranch) => {
              const branch = management ? { ...listedBranch, isCurrent: listedBranch.name === currentBranch } : listedBranch;
              const otherFolder = !branch.isCurrent ? worktrees.find((entry) => entry.branch === branch.name && entry.path !== (workingFolderPath ?? workspacePath)) : undefined;
              return (
              <div
                key={branch.name}
                className={`git-branch-item ${branch.isCurrent ? 'current' : ''}`}
              >
                <div className="git-branch-name" title={branch.name}>
                  <span>{branch.name}</span>
                  {branch.isCurrent && <span className="git-branch-current">Current</span>}
                  {otherFolder && <span className="git-branch-location" title={otherFolder.path}>Open in another folder</span>}
                </div>
                <div className="git-branch-actions">
                  {otherFolder && onViewWorktree ? <Button size="xs" variant="ghost" type="button" title={otherFolder.path} aria-label={`View working folder for ${branch.name}`} disabled={isBusy} onClick={() => onViewWorktree(otherFolder)}>View folder</Button> : <Button
                    size="xs"
                    variant="ghost"
                    type="button"
                    className="git-branch-action"
                    title={branch.isCurrent ? 'Already checked out here' : `Switch workspace checkout to ${branch.name}; Git may refuse a branch used by another worktree`}
                    aria-label={management ? `Switch to branch ${branch.name}` : undefined}
                    onClick={() => onSwitchBranch(branch.name)}
                    disabled={branch.isCurrent || !!otherFolder || isBusy}
                  >
                    {activeAction === `switch:${branch.name}` ? (
                      <Loader2 size={12} className="spin" />
                    ) : null}
                    Switch
                  </Button>}
                  <Button
                    size="xs"
                    variant="ghost"
                    type="button"
                    className="git-branch-action danger"
                    title={branch.isCurrent ? 'The current branch cannot be deleted' : `Delete ${branch.name}; Git checks other worktrees and unmerged commits`}
                    aria-label={management ? `Delete branch ${branch.name}` : undefined}
                    onClick={() => onDeleteBranch(branch.name)}
                    disabled={branch.isCurrent || !!otherFolder || isBusy}
                  >
                    {activeAction === `delete:${branch.name}` ? (
                      <Loader2 size={12} className="spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                    Delete
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
