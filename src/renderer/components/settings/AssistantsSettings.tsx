import { useEffect } from 'react';
import { useAssistantsStore } from '../../store/assistantsStore';
import type { HermesAssistantServiceState } from '../../../shared/types/assistants';
import { Button } from '../ui/Button';
import '../assistants/AssistantsRoster.css';

const STATUS: Record<HermesAssistantServiceState, string> = {
  disabled: 'Off',
  probing: 'Connecting…',
  starting: 'Starting…',
  connected: 'Connected',
  offline: 'Offline',
  error: 'Error',
  'detected-unusable': 'Detected, but unusable',
};

/** The only Assistants management surface: two options, a status and Retry. */
export default function AssistantsSettings() {
  const snapshot = useAssistantsStore((state) => state.snapshot);
  const error = useAssistantsStore((state) => state.error);
  const busy = useAssistantsStore((state) => state.busy);
  const ensure = useAssistantsStore((state) => state.ensureSubscribed);
  const configure = useAssistantsStore((state) => state.configure);
  const refresh = useAssistantsStore((state) => state.refresh);
  useEffect(() => { ensure(); }, [ensure]);
  const settings = snapshot?.settings;
  const service = snapshot?.service;
  return (
    <div className="settings-section" aria-label="Hermes Assistants">
      <div className="settings-section-title">Hermes Assistants</div>
      <label className="settings-option">
        <input type="checkbox" checked={settings?.enabled ?? false} disabled={!settings || busy}
          onChange={(event) => settings && void configure({ ...settings, enabled: event.target.checked })} />
        <span>Enable Hermes Assistants</span>
      </label>
      <label className="settings-option">
        <input type="checkbox" checked={settings?.autoStart ?? false} disabled={!settings || !settings.enabled || busy}
          onChange={(event) => settings && void configure({ ...settings, autoStart: event.target.checked })} />
        <span>Start Hermes service when needed</span>
      </label>
      <p className="assistants-roster-status">
        Needs Hermes Bot Mode (<code>hermes serve</code>). The ordinary Hermes harness works independently of this.
      </p>
      {settings?.enabled && service && (
        <div className="settings-row">
          <span role="status">Status: {STATUS[service.state]}</span>
          <Button size="xs" disabled={busy} onClick={() => void refresh()}>Retry</Button>
        </div>
      )}
      {service?.error && settings?.enabled && <p className="assistants-roster-error" role="alert">{service.error}</p>}
      {error && <p className="assistants-roster-error" role="alert">{error}</p>}
    </div>
  );
}
