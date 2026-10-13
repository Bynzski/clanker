import { Button } from '../ui/Button';
import type { GitResourcePhase } from './useGitMenuResource';

export function GitResourceNotice({ name, resource, onRetry }: { name: string; resource: { phase: GitResourcePhase; data: unknown; error: string | null }; onRetry?: () => void }) {
  if (resource.phase === 'ready') return null;
  return <div data-git-resource={name} data-state={resource.phase}>
    <p role={resource.phase === 'error' ? 'alert' : 'status'}>
      {name}: {resource.phase === 'loading' ? 'Loading…' : resource.phase === 'error' ? <span>{resource.error || 'Unavailable'}</span> : 'Not requested'}
      {resource.data !== null && ' · Last known / partial information (not current)'}
      {resource.phase === 'error' && ' · Use Refresh to retry.'}
    </p>
    {resource.phase === 'error' && onRetry && <Button size="xs" onClick={onRetry}>Retry {name}</Button>}
  </div>;
}
