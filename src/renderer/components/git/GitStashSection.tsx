import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Loader2 } from 'lucide-react';
import type { GitStash } from './types';
import './GitStashSection.css';

interface GitStashSectionProps {
  activeAction: string | null;
  includeUntracked: boolean;
  isBusy: boolean;
  isLoadingStashes: boolean;
  onApplyStash: (stash: GitStash) => void;
  onClearStashes: () => void;
  onDropStash: (stash: GitStash) => void;
  onPopStash: (stash: GitStash) => void;
  onSetIncludeUntracked: (value: boolean) => void;
  onSetStashMessage: (value: string) => void;
  onStash: () => void;
  stashMessage: string;
  stashes: GitStash[];
  management?: boolean;
}

export function GitStashSection({
  activeAction,
  includeUntracked,
  isBusy,
  isLoadingStashes,
  onApplyStash,
  onClearStashes,
  onDropStash,
  onPopStash,
  onSetIncludeUntracked,
  onSetStashMessage,
  onStash,
  stashMessage,
  stashes,
  management = false,
}: GitStashSectionProps) {
  return (
    <div className={`git-menu-section${management ? ' source-control-stashes' : ''}`}>
      <div className="git-menu-section-header">
        Stash
        <span className="git-menu-count">{stashes.length}</span>
      </div>

      <div className="git-stash-form">
        <Input variant="mono"
          className="git-stash-input"
          value={stashMessage}
          onChange={(event) => onSetStashMessage(event.target.value)}
          placeholder="Optional stash message"
          disabled={isBusy}
        />
        <label className="git-stash-toggle">
          <input
            type="checkbox"
            checked={includeUntracked}
            onChange={(event) => onSetIncludeUntracked(event.target.checked)}
            disabled={isBusy}
          />
          <span>Untracked</span>
        </label>
        <Button
          size="xs"
          type="button"
          className="header-btn git-create-branch-submit"
          onClick={onStash}
          disabled={isBusy}
        >
          {activeAction === 'stash' ? <Loader2 size={13} className="spin" /> : null}
          Stash
        </Button>
      </div>

      {stashes.length > 0 && (
        <div className="git-stash-toolbar">
          <span>Available stashes</span>
          <Button
            size="xs"
            variant="ghost"
            type="button"
            className="git-stash-clear"
            title="Permanently delete all stashes in this repository"
            onClick={onClearStashes}
            disabled={isBusy}
          >
            Clear All
          </Button>
        </div>
      )}

      {isLoadingStashes ? (
        <div className="git-menu-empty">Loading stashes…</div>
      ) : stashes.length === 0 ? (
        <div className="git-menu-empty">Nothing stashed yet</div>
      ) : (
        <div className="git-stash-list">
          {stashes.map((stash) => (
            <div key={stash.ref} className="git-stash-item">
              <div className="git-stash-meta">
                <span className="git-stash-ref">{stash.ref}</span>
                {stash.hash ? <span className="git-stash-hash">{stash.hash.slice(0, 7)}</span> : null}
                <span className="git-stash-message">{stash.message}</span>
              </div>
              <div className="git-stash-actions">
                <Button
                  size="xs"
                  variant="ghost"
                  type="button"
                  className="git-branch-action"
                  title="Restore changes without deleting the stash entry"
                  aria-label={`Apply ${stash.ref}`}
                  onClick={() => onApplyStash(stash)}
                  disabled={isBusy}
                >
                  Apply
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  type="button"
                  className="git-branch-action"
                  title="Apply changes and delete stash entry if applied cleanly without conflict"
                  aria-label={`Pop ${stash.ref}`}
                  onClick={() => onPopStash(stash)}
                  disabled={isBusy}
                >
                  Pop
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  type="button"
                  className="git-branch-action danger"
                  title="Permanently delete this stash entry"
                  aria-label={`Drop ${stash.ref}`}
                  onClick={() => onDropStash(stash)}
                  disabled={isBusy}
                >
                  Drop
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
