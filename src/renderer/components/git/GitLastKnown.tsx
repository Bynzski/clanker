import type { CheckoutGitDescription } from '../../store/checkoutGitStore';

function branchLabel(description: CheckoutGitDescription): string {
  return !description.isRepo ? 'Not a repository' : description.isDetached
    ? `Detached HEAD${description.currentBranch ? ` · ${description.currentBranch}` : ''}`
    : description.currentBranch || 'No branch';
}
function countLabel(count: number): string { return `${count} ${count === 1 ? 'change' : 'changes'}`; }
export function gitLastKnownTitle(description: CheckoutGitDescription, unavailable: boolean, error?: string): string {
  const tracking = description.isRepo && description.upstream ? ` · ${description.upstream} (${description.ahead} ahead, ${description.behind} behind)` : '';
  const summary = `${branchLabel(description)}${description.isRepo ? ` · ${countLabel(description.changeCount)}` : ''}${tracking}`;
  return `${summary} · Last known (not current). ${unavailable ? `Git status unavailable${error ? `: ${error}` : ''}` : 'Refreshing Git…'}`;
}

/** Display-only: no current dirty badge, repo gating, change list or action props. */
export function GitLastKnown({ description, unavailable }: { description: CheckoutGitDescription; unavailable: boolean }) {
  return <span className="git-last-known" data-git-state={unavailable ? 'unavailable' : 'loading'} data-git-last-known="true">
    <span className="git-last-known-branch">{branchLabel(description)}</span>
    {description.isRepo && <span> · {countLabel(description.changeCount)}</span>}
    <span> · Last known</span>
    {unavailable && <span> · <span>Git unavailable</span></span>}
  </span>;
}
