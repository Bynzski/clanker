import { Button } from '../ui/Button';
import { FormMessage } from '../ui/Field';
import { getProviderLabel } from './gitButtonViewModels';
import { GitResourceNotice } from './GitResourceNotice';
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
    isBusy, remoteAction, providerContext, pullRequest, vcsContextError, isLoadingContext,
    statusErrorMessage, remoteError, scope, statusKnown } = props;
  const resource = props.resources?.provider;
  // Accepted partial data can confirm PR discovery independently of CI/review.
  // A thrown refresh retains the same data, but cannot confirm anything current.
  const providerCurrent = resource ? resource.phase === 'ready' || resource.phase === 'error' && resource.dataCurrent : !isLoadingContext;
  const loadingProvider = resource ? resource.phase === 'loading' : isLoadingContext;
  const retainedProvider = resource ? resource.data !== null : Boolean(providerContext || pullRequest);
  const providerLabel = (label: string, loading: string) => providerCurrent ? label
    : retainedProvider ? `${loadingProvider ? `${loading} · ` : ''}Last known / unverified: ${label.replace(/ \(confirmed\)/g, '')}`
    : loadingProvider ? loading : 'Unknown / unavailable';
  const foundPr = pullRequest?.exists === true && (pullRequest.outcome === 'found' || !pullRequest.outcome && !vcsContextError);
  const noPr = pullRequest?.outcome === 'none' || pullRequest?.exists === false && !pullRequest.outcome && !vcsContextError;
  return <div className="source-control-overview">
    <div className="source-control-page-heading"><h2 tabIndex={-1} className="clanker-dialog-title">Overview</h2>
      <Button size="xs" disabled={isBusy} onClick={props.onRefresh}>Refresh</Button></div>
    <div className="source-control-actions">
      <Button disabled={isBusy} onClick={props.onReviewChanges}>Review Changes</Button>
    </div>
    {!props.isDetached && <GitRemoteActionsSection currentBranch={props.currentBranch} hasRemotes={props.remotes.length > 0}
      isBusy={isBusy || !statusKnown || Boolean(props.resources && props.resources.remote.phase !== 'ready')} remoteAction={remoteAction} upstream={upstream} onFetch={props.onFetch} onPull={props.onPull} onPush={props.onPush} onPublish={props.onPublish} />}
    {props.resources && (['operation', 'remote', 'provider'] as const).map(name => <GitResourceNotice key={name} name={name} resource={props.resources![name]} onRetry={() => {
      if (name === 'operation') void props.resources!.readOperation(true);
      if (name === 'remote') void props.resources!.readRemotes(true);
      if (name === 'provider') void props.resources!.readProvider(true);
    }} />)}
    <dl className="source-control-identity">
      <dt>Working checkout</dt><dd>{scope.path}</dd>
      <dt>Environment</dt><dd>{scope.environmentId === 'local' ? 'Local' : `SSH · ${scope.environmentId}`}</dd>
      <dt>Checkout context</dt><dd>{scope.checkoutLabel}</dd>
      <dt>Current Branch</dt><dd>{statusKnown ? currentBranchLabel : 'Status unavailable'}</dd>
      <dt>Upstream</dt><dd>{statusKnown ? upstream ?? 'No upstream' : 'Unknown'}</dd>
      <dt>Ahead / behind</dt><dd>{statusKnown && upstream ? `${ahead} ahead · ${behind} behind` : 'Unknown'}</dd>
      <dt>Changed files</dt><dd>{statusKnown ? `${changeCount} changed` : 'Unknown'}</dd>
      <dt>Operation</dt><dd>{isLoadingOperation ? 'Checking operation…' : operationState?.success ? operationState.inProgress ? operationState.message || `${operationState.mode} in progress` : 'No operation in progress' : 'Unknown'}</dd>
      <dt>Provider repository</dt><dd>{providerContext
        ? providerLabel(`${getProviderLabel(providerContext.provider)} · ${providerContext.owner}/${providerContext.repo}`, 'Loading provider repository…')
        // A remote-derived provider name is independent of authenticated PR discovery.
        : props.provider === 'unknown' ? 'Unknown provider' : getProviderLabel(props.provider)}</dd>
      <dt>Pull request</dt><dd>{providerLabel(noPr ? 'No pull request (confirmed)' : foundPr ? `#${pullRequest?.number} · ${pullRequest?.state ?? 'Unknown state'}` : `Unknown / unavailable${pullRequest?.problem ? ` (${pullRequest.problem.code})` : ''}`, 'Loading provider context…')}</dd>
      <dt>CI (checkout HEAD)</dt><dd>{providerLabel(summaryLabel(props.ci, 'No checks (confirmed)'), 'Loading CI…')}</dd>
      <dt>Review</dt><dd>{providerLabel(noPr ? 'Not applicable (no pull request)' : summaryLabel(props.review, 'No active review decisions or requests'), 'Loading reviews…')}</dd>
    </dl>
    {[statusErrorMessage, remoteError, !props.resources ? vcsContextError : null, operationState?.success === false ? operationState.error : null].filter(Boolean).map((error, index) => <FormMessage key={index} variant="error">{error}</FormMessage>)}
    {providerCurrent && foundPr && pullRequest?.url && <Button onClick={() => void window.electronAPI.openExternal(pullRequest.url!)}>View pull request</Button>}
  </div>;
}
