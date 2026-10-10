import { Eye } from 'lucide-react';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { FormMessage } from '../ui/Field';
import type { GitRepoMenuProps } from './GitRepoMenu';
import { useFileDiffReview } from './useFileDiffReview';
import { FileDiffReview } from './FileDiffReview';
import { CommitComposer } from './CommitComposer';
import { changedFileCount, gitStatusBadge } from './gitChangePresentation';
import './GitChanges.css';

export function GitChanges(props: GitRepoMenuProps) {
  const { changes, isScopeCurrent, workspaceId, workspacePath } = props;
  const { diffState, viewDiff, closeDiff } = useFileDiffReview(workspacePath, workspaceId,
    props.statusKnown, `${JSON.stringify(changes)}:${props.reviewRevision}`, isScopeCurrent);
  const disabled = props.isBusy || props.isLoadingChanges || !props.statusKnown;
  const staged = changes.filter((change) => change.staged);
  const working = changes.filter((change) => !change.staged);
  const count = changedFileCount(changes);
  return <div className="source-control-page source-control-changes">
    <div className="source-control-change-heading">
      <h2 tabIndex={-1} className="clanker-dialog-title">Changes</h2>
      <Button size="xs" disabled={props.isBusy || props.isLoadingChanges} onClick={() => void props.onRefreshChanges()}>Refresh changes</Button>
    </div>
    <p className="source-control-change-identity">{props.scope.environmentId === 'local' ? 'Local' : `SSH · ${props.scope.environmentId}`} · {props.scope.path}<br />
      {props.scope.checkoutLabel} · <strong>{props.statusKnown ? props.currentBranchLabel : 'Unknown branch'}</strong> · {props.statusKnown ? `${count} changed file${count === 1 ? '' : 's'}` : 'Changes unavailable'}</p>
    {props.activeAction?.startsWith('stage') && <p role="status">Staging changes…</p>}
    {props.activeAction?.startsWith('unstage') && <p role="status">Unstaging changes…</p>}
    {[props.statusErrorMessage, props.changesError].filter(Boolean).map((error, index) => <FormMessage key={index} variant="error">{error}</FormMessage>)}
    {props.isLoadingChanges ? <p role="status">Loading changes…</p> : !props.statusKnown ? <p role="status">Changes unavailable</p> : <>
      {!changes.length && <p className="source-control-change-empty">Working directory is clean</p>}
      {([{ title: 'Staged changes', items: staged, mode: 'staged' }, { title: 'Unstaged changes', items: working, mode: 'working' }] as const).map((group) => <section key={group.mode} aria-label={group.title}>
        <div className="source-control-file-heading">
          <h3>{group.title} ({group.items.length})</h3>
          <Button size="xs" disabled={disabled || !group.items.length}
            onClick={() => void (group.mode === 'staged' ? props.onUnstageAll() : props.onStageAll())}>{group.mode === 'staged' ? 'Unstage All' : 'Stage All'}</Button>
        </div>
        {!group.items.length ? <p className="source-control-change-empty">No {group.mode === 'staged' ? 'staged' : 'unstaged'} changes</p> : <ul className="source-control-file-list">
          {group.items.map((change) => <li key={`${group.mode}:${change.path}`}>
            <span className={`source-control-file-status ${change.status}`} title={change.status}>{gitStatusBadge(change.status)}</span>
            <Button variant="ghost" className="source-control-file-path" disabled={disabled}
              aria-label={`Review ${group.mode} changes for ${change.path}`} title={change.path}
              onClick={() => void viewDiff(change.path, group.mode)}>{change.path}</Button>
            <IconButton variant="ghost" size="sm" disabled={disabled}
              aria-label={`View ${group.mode} diff for ${change.path}`}
              title={`View Diff · HEAD to ${group.mode === 'staged' ? 'index' : 'working file (includes staged edits)'}`}
              onClick={() => void viewDiff(change.path, group.mode)}><Eye size={14} /></IconButton>
            <Button size="xs" disabled={disabled} aria-label={`${change.staged ? 'Unstage' : 'Stage'} ${change.path}`}
              onClick={() => void (change.staged ? props.onUnstageFile(change.path) : props.onStageFile(change.path))}>{change.staged ? 'Unstage' : 'Stage'}</Button>
          </li>)}
        </ul>}
      </section>)}
    </>}
    <CommitComposer composer={props.commitComposer} stagedCount={staged.length} workingCount={working.length}
      disabled={disabled} statusKnown={props.statusKnown} progress={props.commitProgress} />
    <FileDiffReview state={diffState} workspaceId={workspaceId} onClose={closeDiff} />
  </div>;
}
