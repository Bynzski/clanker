import type { HermesAssistant } from '../../../../shared/types/assistants';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Field, FieldLabel, FormMessage } from '../../ui/Field';
import { Select } from '../../ui/Select';

export function AssistantProfileSelector({ profiles, selectedId, hiddenIds, connected, enabled, busy, onSelect, onRefresh, onVisibilityChange }: {
  profiles: HermesAssistant[]; selectedId: string; hiddenIds: string[]; connected: boolean; enabled: boolean; busy: boolean;
  onSelect(id: string): void; onRefresh(): void; onVisibilityChange(id: string, hidden: boolean): void;
}) {
  const selected = profiles.find((profile) => profile.id === selectedId);
  return <>
    <div className="assistants-profile-controls">
      {connected && <Field><FieldLabel htmlFor="setting-assistant-profile">Profile</FieldLabel>
        <Select id="setting-assistant-profile" value={selectedId} onChange={(event) => onSelect(event.target.value)}>
          <option value="">Select a Hermes profile…</option>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}{profile.hiddenInHermes ? ' · Hidden in Hermes' : hiddenIds.includes(profile.id) ? ' · Hidden' : ''}</option>)}
        </Select>
      </Field>}
      <Button variant="secondary" size="sm" disabled={!enabled || busy} onClick={onRefresh}>Refresh profiles</Button>
    </div>
    {connected && !profiles.length && <FormMessage>No named Hermes profiles reported.</FormMessage>}
    {connected && selectedId && !selected && <FormMessage role="status">Selected profile is no longer available. Choose another profile.</FormMessage>}
    {connected && selected && <>
      <Checkbox checked={hiddenIds.includes(selected.id) || selected.hiddenInHermes === true} disabled={busy || selected.hiddenInHermes === true}
        onChange={(event) => onVisibilityChange(selected.id, event.target.checked)}>Hide from roster</Checkbox>
      <FormMessage>{selected.hiddenInHermes ? 'Hidden by Hermes. Change that preference in Hermes to show it here.' : 'Clanker-only visibility. Open Bot Chat and Browser stay running; unhide this profile here whenever needed.'}</FormMessage>
    </>}
  </>;
}
