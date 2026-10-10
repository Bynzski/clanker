import { Select } from '../ui/Select';
import { Field, FieldLabel } from '../ui/Field';
import { ACCOUNT_HARNESS_IDS, HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import HarnessAccountsRow from './HarnessAccountsRow';

/** Only this page mounts an account workflow. Selection never substitutes another scope. */
export default function AccountsSettings({ environmentId, harnessId, onSelect, availableHarnessIds, discoveryStatus, intent, onIntentConsumed }: {
  environmentId: string;
  harnessId: string | null;
  onSelect: (id: string) => void;
  availableHarnessIds: string[];
  discoveryStatus: 'loading' | 'ready' | 'failed';
  intent?: 'manage' | 'add';
  onIntentConsumed: () => void;
}) {
  const descriptor = ACCOUNT_HARNESS_IDS.find((id) => id === harnessId);
  return <div className="settings-account-page">
    <Field>
      <FieldLabel htmlFor="account-harness">Harness</FieldLabel>
      <Select id="account-harness" value={harnessId ?? ''} onChange={(event) => onSelect(event.target.value)}>
        <option value="" disabled>Select a harness</option>
        {ACCOUNT_HARNESS_IDS.map((id) => <option key={id} value={id} disabled={!availableHarnessIds.includes(id)}>
          {HARNESS_DESCRIPTORS[id].name}{availableHarnessIds.includes(id) ? '' : ' (unavailable)'}
        </option>)}
      </Select>
    </Field>
    <p className="management-page-description">Account selection applies to future launches only. Existing conversations keep their account.</p>
    {discoveryStatus !== 'ready' ? <p role="status">{discoveryStatus === 'failed' ? 'Harness discovery failed. Account actions are unavailable.' : 'Discovering harnesses…'}</p> :
      !descriptor ? <p className="management-page-description">Select a supported harness to manage accounts.</p> :
        !availableHarnessIds.includes(descriptor) ? <p role="status">{HARNESS_DESCRIPTORS[descriptor].name} is unavailable in this environment. Account actions are disabled.</p> :
          <HarnessAccountsRow key={`${environmentId}:${descriptor}`} harnessId={descriptor} harnessLabel={HARNESS_DESCRIPTORS[descriptor].name}
            environmentId={environmentId} intent={intent} onIntentConsumed={onIntentConsumed} />}
  </div>;
}
