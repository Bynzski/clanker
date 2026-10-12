import { Button } from '../ui/Button';
import { FormMessage } from '../ui/Field';
import { getProviderLabel } from './gitButtonViewModels';
import { GitRemoteActionsSection } from './GitRemoteActionsSection';
import type { GitRepoMenuProps } from './GitRepoMenu';
import type { CiSummary, ReviewSummary } from '../../../shared/types/vcs';

function summaryLabel(summary: CiSummary | ReviewSummary | undefined, none: string) {
  if (!summary) return 'Unknown / unavailable';
  const state = summary.state === 'none' ? none : summary.state === 'unknown' ? 'Unknown / unavailable' : summary.state.replace(/_/g, ' ');
  return summary.problem ? `${state} · partial / unavailable (${summary.problem.code})` : state;
}
import './SourceControl.css';

export function GitOverview(props: GitRepoMenuProps & { onReviewChanges: () => void }) {
  const { currentBranchLabel, upstream, ahead, behind, changeCount, operationState, isLoadingOperation,
    isLoadingBranches, isBusy, remoteAction, providerContext, pullRequest, vcsContextError, isLoadingContext,
    statusErrorMessage, branchError, remoteError, scope, statusKnown } = props;
  // A CI/review failure does not invalidate independently confirmed PR discovery.
  const foundPr = !isLoadingContext && pullRequest?.exists === true && (pullRequest.outcome === 'found' || !pullRequest.outcome && !vcsContextError);
  const noPr = !isLoadingContext && (pullRequest?.outcome === 'none' || pullRequest?.exists === false && !pullRequest.outcome && !vcsContextError);
  return <div className="source-control-overview">
    <div className="source-control-page-heading"><h2 tabIndex={-1} className="clanker-dialog-title">Overview</h2>
      <Button size="xs" disabled={isBusy || isLoadingBranches || isLoadingOperation} onClick={props.onRefresh}>Refresh</Button></div>
    <div className="source-control-actions">
      <Button disabled={isBusy} onClick={props.onReviewChanges}>Review Changes</Button>
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
      <dt>Pull request</dt><dd>{isLoadingContext ? 'Loading provider context…' : noPr ? 'No pull request (confirmed)' : foundPr ? `#${pullRequest?.number} · ${pullRequest?.state ?? 'Unknown state'}` : `Unknown / unavailable${pullRequest?.problem ? ` (${pullRequest.problem.code})` : ''}`}</dd>
      <dt>CI (checkout HEAD)</dt><dd>{isLoadingContext ? 'Loading CI…' : summaryLabel(props.ci, 'No checks (confirmed)')}</dd>
      <dt>Review</dt><dd>{isLoadingContext ? 'Loading reviews…' : noPr ? 'Not applicable (no pull request)' : summaryLabel(props.review, 'No reviews (confirmed)')}</dd>
    </dl>
    {[statusErrorMessage, branchError, remoteError, vcsContextError, operationState?.success === false ? operationState.error : null].filter(Boolean).map((error, index) => <FormMessage key={index} variant="error">{error}</FormMessage>)}
    {foundPr && pullRequest?.url && <Button onClick={() => void window.electronAPI.openExternal(pullRequest.url!)}>View pull request</Button>}
  </div>;
}
