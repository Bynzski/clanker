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
  onApplyStash: (stashRef: string) => void;
  onClearStashes: () => void;
  onDropStash: (stashRef: string) => void;
  onPopStash: (stashRef: string) => void;
  onSetIncludeUntracked: (value: boolean) => void;
  onSetStashMessage: (value: string) => void;
  onStash: () => void;
  stashMessage: string;
  stashes: GitStash[];
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
}: GitStashSectionProps) {
  return (
    <div className="git-menu-section">
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
                <span className="git-stash-message">{stash.message}</span>
              </div>
              <div className="git-stash-actions">
                <Button
                  size="xs"
                  variant="ghost"
                  type="button"
                  className="git-branch-action"
                  onClick={() => onApplyStash(stash.ref)}
                  disabled={isBusy}
                >
                  Apply
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  type="button"
                  className="git-branch-action"
                  onClick={() => onPopStash(stash.ref)}
                  disabled={isBusy}
                >
                  Pop
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  type="button"
                  className="git-branch-action danger"
                  onClick={() => onDropStash(stash.ref)}
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
