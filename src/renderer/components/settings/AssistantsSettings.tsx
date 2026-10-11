import { useEffect, useState } from 'react';
import AssistantProfileDetail from './AssistantProfileDetail';
import { Select } from '../ui/Select';
import { Info } from 'lucide-react';
import { useAssistantsStore } from '../../store/assistantsStore';
import { AssistantNotice } from '../assistants/AssistantsRoster';
import { IconButton } from '../ui/IconButton';
import { Checkbox } from '../ui/Checkbox';
import '../assistants/AssistantsRoster.css';

const PROBLEM: Record<string, string> = {
  offline: 'Hermes service is not running',
  error: 'Could not connect to Hermes',
  'detected-unusable': 'Hermes service found, but Clanker cannot connect to it',
};
const TRANSITION: Record<string, string> = { probing: 'Connecting…', starting: 'Starting Hermes service…' };

/** Optional Hermes Assistants. Absent entirely unless the Hermes CLI is installed. */
export default function AssistantsSettings({ initialAssistantId }: { initialAssistantId?: string | null }) {
  const [selectedId, setSelectedId] = useState(initialAssistantId ?? '');
  const [initialSelection, setInitialSelection] = useState(initialAssistantId);
  if (initialSelection !== initialAssistantId) { setInitialSelection(initialAssistantId); setSelectedId(initialAssistantId ?? ''); }
  const snapshot = useAssistantsStore((state) => state.snapshot);
  const error = useAssistantsStore((state) => state.error);
  const busy = useAssistantsStore((state) => state.busy);
  const ensure = useAssistantsStore((state) => state.ensureSubscribed);
  const configure = useAssistantsStore((state) => state.configure);
  const refresh = useAssistantsStore((state) => state.refresh);
  useEffect(() => { ensure(); }, [ensure]);
  if (!snapshot?.available) return null;
  const { settings, service } = snapshot;
  const connected = settings.enabled && service.state === 'connected';
  const transition = settings.enabled ? TRANSITION[service.state] : undefined;
  const problem = settings.enabled && !connected && !transition ? (error || service.error || PROBLEM[service.state]) : undefined;
  const statusText = !settings.enabled ? 'Off'
    : connected ? `Connected${service.ownership === 'clanker' ? ' · Clanker-managed' : service.ownership === 'external' ? ' · External' : ''}`
    : transition ?? PROBLEM[service.state] ?? 'Not connected';
  const info = `Uses a local Hermes service (hermes serve). Ordinary Hermes harness usage is independent. Status: ${statusText}.`;
  return (
    <div id="setting-assistants" tabIndex={-1} className="settings-section" aria-label="Hermes Assistants">
      <div className="assistants-settings-header">
        <div className="settings-section-title">Hermes Assistants</div>
        <IconButton size="xs" variant="ghost" aria-label="Hermes Assistants information" title={info}>
          <Info size={12} strokeWidth={2} />
        </IconButton>
      </div>
      <p className="management-page-description">{info}</p>
      <Checkbox checked={settings.enabled} disabled={busy}
        onChange={(event) => void configure({ ...settings, enabled: event.target.checked })}>Enable Hermes Assistants</Checkbox>
      <Checkbox checked={settings.autoStart} disabled={!settings.enabled || busy}
        onChange={(event) => void configure({ ...settings, autoStart: event.target.checked })}>Start Hermes service when needed</Checkbox>
      {transition && <AssistantNotice tone="info" message={transition} />}
      {problem && <AssistantNotice tone="error" message={problem} busy={busy} onRetry={() => void refresh()} />}
      {!settings.enabled && error && <AssistantNotice tone="error" message={error} />}
      {connected && <>
        <label htmlFor="setting-assistant-profile">Profile</label>
        <Select id="setting-assistant-profile" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">Select a Hermes profile…</option>
          {snapshot.assistants.map((assistant) => <option key={assistant.id} value={assistant.id}>{assistant.displayName}</option>)}
        </Select>
        {!snapshot.assistants.length && <p>No named Hermes profiles reported.</p>}
        {selectedId && !snapshot.assistants.some((assistant) => assistant.id === selectedId) && <p role="status">Selected profile is no longer available. Choose another profile.</p>}
      </>}
      {connected && snapshot.assistants.filter((assistant) => assistant.id === selectedId).map((assistant) => <AssistantProfileDetail key={assistant.id} assistant={assistant} connected={connected} />)}
    </div>
  );
}
