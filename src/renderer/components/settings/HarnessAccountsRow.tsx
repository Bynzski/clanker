import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useHarnessAccounts } from '../useHarnessAccounts';
import { HARNESS_ACCOUNT_LABEL_MAX, type SafeHarnessAccount } from '../../../shared/types/harnessAccounts';

interface Props {
  harnessId: string;
  harnessLabel: string;
  /** Account selection is scoped to environment + harness. */
  environmentId?: string;
  /** One-shot renderer-only hint from the Usage panel; consumed once by this row. */
  intent?: 'manage' | 'add';
  onIntentConsumed?: () => void;
}

function accountName(account: SafeHarnessAccount): string {
  if (account.kind === 'default') return 'Default';
  return account.label ?? account.email ?? 'Account';
}

function accountDetail(account: SafeHarnessAccount): string {
  if (account.kind === 'default') return 'Your existing sign-in';
  return [account.label ? account.email : undefined, account.plan].filter(Boolean).join(' · ');
}

/**
 * Compact accounts area. With only the native account it is one quiet line and an "Add account"
 * action; nothing else appears until a managed account exists. Selection applies to new launches only.
 */
export default function HarnessAccountsRow({ harnessId, harnessLabel, environmentId = 'local', intent, onIntentConsumed }: Props) {
  const accounts = useHarnessAccounts(environmentId, harnessId, true);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const { list, flow, error, busy } = accounts;
  const rootRef = useRef<HTMLDivElement>(null);
  const managedSupported = list?.managedSupported === true;
  const listReady = list !== null;
  // Add opens the existing inline add state (only where managed accounts are supported); Manage just
  // brings the account area into view. The hint is applied once per delivery (derived during render)
  // and then handed back so the parent can clear it.
  const [appliedIntent, setAppliedIntent] = useState<typeof intent>(undefined);
  if (intent && listReady && appliedIntent !== intent) {
    setAppliedIntent(intent);
    if (intent === 'add' && managedSupported) setAdding(true);
  } else if (!intent && appliedIntent) {
    setAppliedIntent(undefined);
  }
  useEffect(() => {
    if (!intent || !listReady) return;
    rootRef.current?.scrollIntoView?.({ block: 'nearest' });
    onIntentConsumed?.();
  }, [intent, listReady, onIntentConsumed]);
  if (!list) return null;

  const pending = flow !== null && flow.state.status !== 'connected' && flow.state.status !== 'failed' && flow.state.status !== 'cancelled';
  const multiple = list.accounts.length > 1;
  const flowMessage = flow?.state.status === 'failed' ? flow.state.message : flow?.state.status === 'cancelled' ? 'Sign-in cancelled.' : null;

  return (
    <div ref={rootRef} className="harness-defaults-field harness-accounts" aria-label={`${harnessLabel} accounts`}>
      <span className="harness-defaults-field-label">{multiple ? 'Accounts' : 'Account'}</span>
      <ul className="harness-accounts-list">
        {list.accounts.map((account) => (
          <li key={account.id} className={`harness-account ${account.selected ? 'selected' : ''}`}>
            <span className="harness-account-text">
              <span className="harness-account-name">{accountName(account)}</span>
              {accountDetail(account) && <span className="harness-account-detail">{accountDetail(account)}</span>}
              {account.status === 'needs-auth' && <span className="harness-account-warning">Needs sign-in</span>}
            </span>
            {multiple && (account.selected
              ? <span className="harness-account-selected">In use</span>
              : <Button disabled={busy || pending} onClick={() => void accounts.select(account.id)} aria-label={`Use ${accountName(account)} for ${harnessLabel}`}>Use</Button>)}
            {account.kind === 'managed' && (
              <>
                {account.status === 'needs-auth' && (
                  <Button disabled={busy || pending} onClick={() => void accounts.reconnect(account.id)}>Reconnect</Button>
                )}
                <Button variant="danger" disabled={busy || pending} onClick={() => void accounts.remove(account.id)} aria-label={`Remove ${accountName(account)}`}>Remove</Button>
              </>
            )}
          </li>
        ))}
      </ul>

      {pending ? (
        <div className="harness-account-flow" role="status">
          <span>{flow.state.status === 'waiting-for-browser' ? 'Finish signing in in your browser…' : 'Starting sign-in…'}</span>
          <Button onClick={accounts.cancel}>Cancel</Button>
        </div>
      ) : !list.managedSupported ? (
        list.unsupportedReason && <span className="harness-account-detail">{list.unsupportedReason}</span>
      ) : adding ? (
        <div className="harness-account-add">
          <Input
            type="text" value={label} maxLength={HARNESS_ACCOUNT_LABEL_MAX} aria-label="Account label"
            placeholder="Label (optional), e.g. Work" onChange={(event) => setLabel(event.target.value)}
          />
          <Button variant="primary" disabled={busy} onClick={() => { void accounts.add(label.trim()); setAdding(false); setLabel(''); }}>Sign in</Button>
          <Button onClick={() => { setAdding(false); setLabel(''); }}>Cancel</Button>
        </div>
      ) : (
        <Button className="harness-account-add-button" disabled={busy} onClick={() => { accounts.dismissFlow(); setAdding(true); }}>Add account</Button>
      )}
      {flowMessage && <span className="harness-account-warning" role="alert">{flowMessage}</span>}
      {error && <span className="harness-account-warning" role="alert">{error}</span>}
    </div>
  );
}
