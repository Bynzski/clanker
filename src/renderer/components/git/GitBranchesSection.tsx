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
  activeAction: string | null;
  branches: GitBranch[];
  createBranchInputRef: React.RefObject<HTMLInputElement | null>;
  currentBranch: string | null;
  isBusy: boolean;
  isLoadingBranches: boolean;
  newBranchName: string;
  onCreateBranch: (event: React.FormEvent) => void;
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
              pullRequest={contextError || isLoadingContext ? null : pullRequest}
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
        <FieldLabel htmlFor="source-control-branch-name">Create Branch</FieldLabel>
        <form
          className="git-create-branch-form"
          onSubmit={(event) => {
            event.preventDefault();
            onCreateBranch(event);
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
          <Button
            size="xs"
            type="submit"
            className="header-btn git-create-branch-submit"
            disabled={isBusy || newBranchName.trim().length === 0}
          >
            {activeAction === 'create' ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
            Create
          </Button>
        </form>
      </div>

      <div className="git-menu-section">
        <div className="git-menu-section-header">
          {management ? 'Local branches' : 'Branches'}
          <span className="git-menu-count">{branches.length}</span>
        </div>

        {isLoadingBranches ? (
          <div className="git-menu-empty">Loading branches…</div>
        ) : branches.length === 0 ? (
          <div className="git-menu-empty">No local branches found</div>
        ) : (
          <div className={`git-branch-list${management ? ' source-control-branch-list' : ''}`}>
            {branches.map((listedBranch) => {
              const branch = management ? { ...listedBranch, isCurrent: listedBranch.name === currentBranch } : listedBranch;
              return (
              <div
                key={branch.name}
                className={`git-branch-item ${branch.isCurrent ? 'current' : ''}`}
              >
                <div className="git-branch-name" title={branch.name}>
                  <span>{branch.name}</span>
                  {branch.isCurrent && <span className="git-branch-current">Current</span>}
                </div>
                <div className="git-branch-actions">
                  <Button
                    size="xs"
                    variant="ghost"
                    type="button"
                    className="git-branch-action"
                    title={branch.isCurrent ? 'Already checked out here' : `Switch workspace checkout to ${branch.name}; Git may refuse a branch used by another worktree`}
                    aria-label={management ? `Switch to branch ${branch.name}` : undefined}
                    onClick={() => onSwitchBranch(branch.name)}
                    disabled={branch.isCurrent || isBusy}
                  >
                    {activeAction === `switch:${branch.name}` ? (
                      <Loader2 size={12} className="spin" />
                    ) : null}
                    Switch
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    type="button"
                    className="git-branch-action danger"
                    title={branch.isCurrent ? 'The current branch cannot be deleted' : `Delete ${branch.name}; Git checks other worktrees and unmerged commits`}
                    aria-label={management ? `Delete branch ${branch.name}` : undefined}
                    onClick={() => onDeleteBranch(branch.name)}
                    disabled={branch.isCurrent || isBusy}
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
