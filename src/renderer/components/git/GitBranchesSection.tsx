import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { GitBranch } from './types';
import './GitBranchesSection.css';

interface GitBranchesSectionProps {
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
}

export function GitBranchesSection({
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
}: GitBranchesSectionProps) {
  return (
    <>
      <div className="git-menu-section">
        <div className="git-menu-section-header">Create Branch</div>
        <form className="git-create-branch-form" onSubmit={onCreateBranch}>
          <input
            ref={createBranchInputRef}
            className="git-create-branch-input"
            value={newBranchName}
            onChange={(event) => onSetNewBranchName(event.target.value)}
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
                    onClick={() => onSwitchBranch(branch.name)}
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
                    onClick={() => onDeleteBranch(branch.name)}
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
    </>
  );
}
