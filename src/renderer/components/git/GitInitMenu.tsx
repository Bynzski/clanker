import { ChevronDown, GitBranch as GitBranchIcon, Loader2, X } from 'lucide-react';

interface GitInitMenuProps {
  initError: string | null;
  isInitializing: boolean;
  isMenuOpen: boolean;
  onClose: () => void;
  onInitialize: () => void;
  onSelectDefaultBranch: (branch: string) => void;
  onToggleMenu: () => void;
  selectedDefaultBranch: string;
  statusErrorMessage: string | null;
}

export function GitInitMenu({
  initError,
  isInitializing,
  isMenuOpen,
  onClose,
  onInitialize,
  onSelectDefaultBranch,
  onToggleMenu,
  selectedDefaultBranch,
  statusErrorMessage,
}: GitInitMenuProps) {
  return (
    <>
      <button
        className="header-btn git-btn"
        onClick={onToggleMenu}
        title="Initialize Git Repository"
      >
        <GitBranchIcon size={15} strokeWidth={2} />
        <span>Init Git</span>
        <ChevronDown size={12} strokeWidth={2.5} />
      </button>

      {isMenuOpen && (
        <div className="git-menu" role="menu">
          <div className="git-menu-header">
            <div>
              <div className="git-menu-label">Initialize Repository</div>
              <div className="git-menu-branch">No git repository found</div>
            </div>
            <button
              type="button"
              className="git-menu-close"
              onClick={onClose}
              title="Close"
            >
              <X size={15} />
            </button>
          </div>

          <div className="git-menu-section">
            <div className="git-menu-section-header">
              <span>Initial Branch</span>
            </div>
            <div className="git-init-branch-options">
              <label className="git-init-branch-option">
                <input
                  type="radio"
                  name="defaultBranch"
                  value="main"
                  checked={selectedDefaultBranch === 'main'}
                  onChange={() => onSelectDefaultBranch('main')}
                />
                <span>main</span>
              </label>
              <label className="git-init-branch-option">
                <input
                  type="radio"
                  name="defaultBranch"
                  value="master"
                  checked={selectedDefaultBranch === 'master'}
                  onChange={() => onSelectDefaultBranch('master')}
                />
                <span>master</span>
              </label>
            </div>
          </div>

          {statusErrorMessage && <div className="git-menu-error">{statusErrorMessage}</div>}
          {initError && <div className="git-menu-error">{initError}</div>}

          <div className="git-menu-actions">
            <button
              type="button"
              className="header-btn header-btn-primary git-menu-action"
              onClick={onInitialize}
              disabled={isInitializing}
            >
              {isInitializing && <Loader2 size={13} className="spin" />}
              {isInitializing ? 'Initializing...' : 'Initialize Repository'}
            </button>
          </div>

          <p className="git-init-hint">
            This will create a new git repository in the current workspace.
          </p>
        </div>
      )}
    </>
  );
}
