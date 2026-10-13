import { Button } from '../ui/Button';

/** Directory-local acquisition notice; history never proves existence or permissions. */
export function DirectoryFreshness({ known, current, loading, error, onRetry }: {
  known: boolean; current: boolean; loading: boolean; error?: string | null; onRetry: () => void;
}) {
  if (current && !loading && !error) return null;
  return <div className={`directory-freshness${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>
    <span>{known ? 'Last known · ' : ''}{loading ? known ? 'Refreshing…' : 'Loading…' : error ? 'Unavailable' : known ? 'Not current' : 'Not requested'}{error && <> · <span>{error}</span></>}</span>
    {error && <Button size="xs" disabled={loading} onClick={onRetry}>Retry directory</Button>}
  </div>;
}
