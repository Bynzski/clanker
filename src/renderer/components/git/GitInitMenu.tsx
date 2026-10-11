import { Button } from '../ui/Button';
import { Field, FieldLabel, FormMessage } from '../ui/Field';
import { Select } from '../ui/Select';

/** Empty-state content only; GitButton owns initialization and main authorizes it. */
export function GitInitMenu({ initError, isInitializing, onInitialize, onSelectDefaultBranch, selectedDefaultBranch, statusErrorMessage, statusKnown }: {
  initError: string | null; isInitializing: boolean; onInitialize: () => void;
  onSelectDefaultBranch: (branch: string) => void; selectedDefaultBranch: string;
  statusErrorMessage: string | null; statusKnown: boolean;
}) {
  return <div className="source-control-overview">
    <h2 className="clanker-dialog-title">Overview</h2>
    <p>{statusKnown ? 'No git repository found' : 'Repository status unavailable. Wait for polling or reopen after refreshing the workspace.'}</p>
    {statusErrorMessage && <FormMessage variant="error">{statusErrorMessage}</FormMessage>}
    {initError && <FormMessage variant="error">{initError}</FormMessage>}
    <Field><FieldLabel htmlFor="git-initial-branch">Initial Branch</FieldLabel><Select id="git-initial-branch" value={selectedDefaultBranch} disabled={isInitializing || !statusKnown} onChange={(event) => onSelectDefaultBranch(event.target.value)}>
      <option value="main">main</option><option value="master">master</option>
    </Select></Field>
    <Button variant="primary" onClick={onInitialize} disabled={isInitializing || !statusKnown}>{isInitializing ? 'Initializing…' : 'Initialize Repository'}</Button>
  </div>;
}
