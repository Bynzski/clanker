import { Button } from '../ui/Button';
import { FormMessage } from '../ui/Field';
import type { GitRepoMenuProps } from './GitRepoMenu';
import { useFileDiffReview } from './useFileDiffReview';
import { FileDiffReview } from './FileDiffReview';
import './GitChanges.css';

import { changedFileCount, gitStatusBadge } from './gitChangePresentation';

export function GitChanges(props: GitRepoMenuProps) {
  const { changes, isScopeCurrent, workspaceId, workspacePath } = props;
  const { diffState, viewDiff, closeDiff } = useFileDiffReview(workspacePath, workspaceId,
    props.statusKnown, `${JSON.stringify(changes)}:${props.reviewRevision}`, isScopeCurrent);
  const disabled = props.isBusy || props.isLoadingChanges || !props.statusKnown;
  const staged = changes.filter((change) => change.staged);
  const working = changes.filter((change) => !change.staged);
  const count = changedFileCount(changes);
  return <div className="source-control-page source-control-changes">
    <h2 tabIndex={-1} className="clanker-dialog-title">Changes</h2>
    <p className="source-control-change-identity">{props.scope.environmentId === 'local' ? 'Local' : `SSH · ${props.scope.environmentId}`} · {props.scope.path}<br />
      {props.scope.checkoutLabel} · Branch: <strong>{props.statusKnown ? props.currentBranchLabel : 'Unknown'}</strong> · {props.statusKnown ? `${count} changed file${count === 1 ? '' : 's'}` : 'Changes unavailable'}</p>
    <div className="source-control-actions">
      <Button variant="primary" disabled={disabled || changes.length === 0} onClick={props.onOpenCommitDialog}>{staged.length ? 'Commit Staged' : 'Stage All & Commit'}</Button>
      <Button disabled={props.isBusy || props.isLoadingChanges} onClick={() => void props.onRefreshChanges()}>Refresh changes</Button>
      <Button disabled={disabled || !working.length} onClick={() => void props.onStageAll()}>Stage All</Button>
      <Button disabled={disabled || !staged.length} onClick={() => void props.onUnstageAll()}>Unstage All</Button>
    </div>
    {[props.statusErrorMessage, props.changesError].filter(Boolean).map((error, index) => <FormMessage key={index} variant="error">{error}</FormMessage>)}
    {props.isLoadingChanges ? <p role="status">Loading changes…</p> : !props.statusKnown ? <p role="status">Changes unavailable</p> : !changes.length ? <p>Working directory is clean</p> : <>
      <p className="source-control-change-help">Diffs compare HEAD to the index (staged) or working file, not index to working file. Selecting a file never stages it.</p>
      {([{ title: 'Staged changes', items: staged, mode: 'staged' }, { title: 'Unstaged changes', items: working, mode: 'working' }] as const).map((group) => <section key={group.mode} aria-label={group.title}>
        <h3>{group.title} ({group.items.length})</h3>
        {!group.items.length ? <p className="source-control-change-help">No {group.mode === 'staged' ? 'staged' : 'unstaged'} changes</p> : <ul className="source-control-file-list">
          {group.items.map((change) => <li key={`${group.mode}:${change.path}`}>
            <span className={`commit-file-status ${change.status}`} title={change.status}>{gitStatusBadge(change.status)}</span>
            <Button variant="ghost" className="source-control-file-path" disabled={disabled}
              aria-label={`View ${group.mode} diff for ${change.path}`} title={change.path}
              onClick={() => void viewDiff(change.path, group.mode)}>{change.path}</Button>
            <Button size="xs" disabled={disabled} aria-label={`${change.staged ? 'Unstage' : 'Stage'} ${change.path}`}
              onClick={() => void (change.staged ? props.onUnstageFile(change.path) : props.onStageFile(change.path))}>{change.staged ? 'Unstage' : 'Stage'}</Button>
          </li>)}
        </ul>}
      </section>)}
    </>}
    <FileDiffReview state={diffState} workspaceId={workspaceId} onClose={closeDiff} />
  </div>;
}
