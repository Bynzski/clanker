import { Button } from '../ui/Button';
import { FormMessage } from '../ui/Field';
import { getProviderLabel } from './gitButtonViewModels';
import { GitRemoteActionsSection } from './GitRemoteActionsSection';
import type { GitRepoMenuProps } from './GitRepoMenu';
import './SourceControl.css';

export function GitOverview(props: GitRepoMenuProps) {
  const { currentBranchLabel, upstream, ahead, behind, changeCount, operationState, isLoadingOperation,
    isLoadingBranches, isBusy, remoteAction, providerContext, pullRequest, vcsContextError, isLoadingContext,
    statusErrorMessage, branchError, remoteError, scope, statusKnown } = props;
  const foundPr = !vcsContextError && !isLoadingContext && pullRequest?.exists === true && (!pullRequest.outcome || pullRequest.outcome === 'found');
  const noPr = !vcsContextError && !isLoadingContext && (pullRequest?.outcome === 'none' || pullRequest?.exists === false && !pullRequest.outcome);
  return <div className="source-control-overview">
    <h2 className="clanker-dialog-title">Overview</h2>
    <div className="source-control-actions">
      <Button variant="primary" disabled={isBusy || !statusKnown} onClick={props.onOpenCommitDialog}>Commit Changes</Button>
      <Button disabled={isBusy || isLoadingBranches || isLoadingOperation} onClick={props.onRefresh}>Refresh</Button>
    </div>
    {!props.isDetached && <GitRemoteActionsSection currentBranch={props.currentBranch} hasRemotes={props.remotes.length > 0}
      isBusy={isBusy || !statusKnown} remoteAction={remoteAction} upstream={upstream} onFetch={props.onFetch} onPull={props.onPull} onPush={props.onPush} onPublish={props.onPublish} />}
    <dl className="source-control-identity">
      <dt>Working checkout</dt><dd>{scope.path}</dd>
      <dt>Environment</dt><dd>{scope.environmentId === 'local' ? 'Local' : `SSH · ${scope.environmentId}`}</dd>
      <dt>Checkout context</dt><dd>{scope.checkoutLabel}</dd>
      <dt>Current Branch</dt><dd>{statusKnown ? currentBranchLabel : 'Status unavailable'}</dd>
      <dt>Upstream</dt><dd>{statusKnown ? upstream ?? 'No upstream' : 'Unknown'}</dd>
      <dt>Ahead / behind</dt><dd>{statusKnown && upstream ? `${ahead} ahead · ${behind} behind` : 'Unknown'}</dd>
      <dt>Changed files</dt><dd>{statusKnown ? `${changeCount} changed` : 'Unknown'}</dd>
      <dt>Operation</dt><dd>{isLoadingOperation ? 'Checking operation…' : operationState?.success ? operationState.inProgress ? operationState.message || `${operationState.mode} in progress` : 'No operation in progress' : 'Unknown'}</dd>
      <dt>Provider repository</dt><dd>{providerContext ? `${getProviderLabel(providerContext.provider)} · ${providerContext.owner}/${providerContext.repo}` : props.provider === 'unknown' ? 'Unknown provider' : getProviderLabel(props.provider)}</dd>
      <dt>Pull request</dt><dd>{isLoadingContext ? 'Loading provider context…' : noPr ? 'No pull request (confirmed)' : foundPr ? `#${pullRequest?.number} · ${pullRequest?.state ?? 'Unknown state'}` : 'Unknown / unavailable'}</dd>
      <dt>CI</dt><dd>{foundPr ? pullRequest?.checksStatus ?? 'Unknown' : 'Unknown'}</dd>
    </dl>
    {[statusErrorMessage, branchError, remoteError, vcsContextError, operationState?.success === false ? operationState.error : null].filter(Boolean).map((error, index) => <FormMessage key={index} variant="error">{error}</FormMessage>)}
    {foundPr && pullRequest?.url && <Button onClick={() => void window.electronAPI.openExternal(pullRequest.url!)}>View pull request</Button>}
    <p>Branches and Worktrees have dedicated pages. Stashes, Remotes, Merge and History remain in Existing Git Tools during migration.</p>
  </div>;
}
