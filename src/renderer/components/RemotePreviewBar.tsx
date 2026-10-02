import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { Input } from './ui/Input';
import { useEffect, useRef, useState } from 'react';
import { isPreviewPort, type RemotePreviewState, type RemotePreviewUpdate, type RemoteWebService, type RemotePreviewRequest } from '../../shared/types/remotePreview';
type ServiceTarget = Pick<RemotePreviewRequest, 'remoteHost' | 'remotePort' | 'protocol'>;
function key(service: ServiceTarget) { return `${service.protocol ?? 'http'}:${service.remoteHost ?? '127.0.0.1'}:${service.remotePort}`; }
export default function RemotePreviewBar({ workspaceId, onOpen, onLayoutChange, enabled = true }: {
  workspaceId: string; onOpen: (url: string) => Promise<unknown>; onLayoutChange: () => void; enabled?: boolean;
}) {
  const [state, setState] = useState<RemotePreviewUpdate>({ workspaceId, forward: null, forwards: [], services: [] });
  const [selected, setSelected] = useState('');
  const [manual, setManual] = useState(false), [remotePort, setRemotePort] = useState('3000');
  const [protocol, setProtocol] = useState<'http' | 'https'>('http');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const consumer = useRef(`browser-${crypto.randomUUID()}`);
  const generation = useRef(0), revision = useRef(0);
  const latest = useRef(state), selection = useRef(''), autoChoice = useRef(''), manualChoice = useRef(false);
  const opening = useRef<string | null>(null), previousStatus = useRef<string | null>(null);
  const active = useRef(enabled), open = useRef(onOpen);
  active.current = enabled; open.current = onOpen;
  const apply = useRef<(snapshot: RemotePreviewUpdate) => void>(() => {});
  apply.current = (snapshot) => {
    latest.current = snapshot; setState(snapshot);
    const forward = snapshot.forwards?.find((entry) => key(entry) === selection.current);
    if (active.current && forward?.status === 'active' && previousStatus.current !== 'active') {
      const current = generation.current;
      void open.current(forward.url).catch(() => { if (generation.current === current) setError('Could not open remote preview'); });
    }
    previousStatus.current = active.current ? forward?.status ?? null : null;
  };
  useEffect(() => {
    const current = ++generation.current; const startRevision = revision.current;
    latest.current = { workspaceId, forward: null, services: [], forwards: [] }; setState(latest.current);
    selection.current = ''; autoChoice.current = ''; manualChoice.current = false; previousStatus.current = null;
    setSelected(''); setError(''); setBusy(false);
    const unsubscribe = window.electronAPI.onRemotePreviewChanged((snapshot) => {
      if (generation.current !== current || snapshot.workspaceId !== workspaceId) return;
      revision.current++; apply.current(snapshot);
    });
    void window.electronAPI.remotePreviewGet({ workspaceId }).then((snapshot) => {
      if (snapshot && generation.current === current && revision.current === startRevision) apply.current(snapshot);
    }).catch(() => { if (generation.current === current) setError('Could not load remote services'); });
    return () => { generation.current = current + 1; unsubscribe(); };
  }, [workspaceId]);
  useEffect(() => {
    if (!enabled) return;
    const current = generation.current, startRevision = revision.current;
    void window.electronAPI.remotePreviewWatch({ workspaceId, consumerId: consumer.current, enabled: true }).then((snapshot) => {
      if (snapshot && generation.current === current && revision.current === startRevision) apply.current(snapshot);
    }).catch(() => { if (generation.current === current) setError('Could not discover remote services'); });
    const token = consumer.current;
    return () => { void window.electronAPI.remotePreviewWatch({ workspaceId, consumerId: token, enabled: false }).catch(() => undefined); };
  }, [workspaceId, enabled]);
  const start = useRef<(service: ServiceTarget) => Promise<void>>(async () => {});
  start.current = async (service) => {
    const chosen = key(service), current = generation.current, startRevision = revision.current;
    selection.current = chosen; setSelected(chosen); previousStatus.current = null; opening.current = chosen;
    setBusy(true); setError('');
    try {
      const result = await window.electronAPI.remotePreviewStart({ workspaceId, remotePort: service.remotePort, remoteHost: service.remoteHost ?? '127.0.0.1', protocol: service.protocol ?? 'http' });
      if (generation.current !== current || !active.current || selection.current !== chosen) return;
      if (!result.success) setError(result.error ?? 'Could not start SSH preview');
      if (result.forward && revision.current === startRevision) {
        const forwards = [...(latest.current.forwards ?? []).filter((entry) => key(entry) !== chosen), result.forward];
        apply.current({ ...latest.current, forward: result.forward, forwards });
      }
    } catch { if (generation.current === current) setError('Could not start SSH preview'); }
    finally { if (generation.current === current) { setBusy(false); opening.current = null; } }
  };
  useEffect(() => {
    if (!enabled || manualChoice.current || opening.current) return;
    const owned = (state.services ?? []).filter((service) => service.confidence === 'workspace');
    if (owned.length !== 1 || key(owned[0]) === autoChoice.current) return;
    const previous = (state.forwards ?? []).find((entry) => key(entry) === autoChoice.current);
    if (previous?.serviceId) void window.electronAPI.remotePreviewStop({ workspaceId, serviceId: previous.serviceId }).catch(() => setError('Could not stop previous preview')); 
    autoChoice.current = key(owned[0]); void start.current(owned[0]);
  }, [state, enabled, workspaceId, busy]);
  const services: Array<RemoteWebService | RemotePreviewState> = [...(state.services ?? [])];
  for (const forward of state.forwards ?? []) if (!services.some((service) => key(service) === key(forward))) services.push(forward);
  const chosen = services.find((service) => key(service) === selected);
  const forward = state.forwards?.find((entry) => key(entry) === selected);
  useEffect(() => onLayoutChange(), [manual, error, state.error, forward?.status, onLayoutChange]);
  return <div className="remote-preview-bar">
    <div className="remote-preview-controls">
      <span>Web services</span>
      <Select aria-label="Detected web services" value={selected} disabled={busy} onChange={(event) => { manualChoice.current = true; selection.current = event.target.value; setSelected(event.target.value); previousStatus.current = null; }}>
        <option value="">{services.length ? 'Choose a service' : 'No web server detected yet'}</option>
        {services.map((service) => <option key={key(service)} value={key(service)}>{service.remotePort} {'processName' in service ? service.processName : ''} {service.protocol === 'https' ? 'HTTPS' : ''}</option>)}
      </Select>
      <Button disabled={!enabled || !chosen || busy} onClick={() => { manualChoice.current = true; if (chosen) void start.current(chosen); }}>Open</Button>
      {forward && <Button disabled={busy || forward.status === 'stopping'} onClick={() => {
        manualChoice.current = true;
        void window.electronAPI.remotePreviewStop({ workspaceId, serviceId: forward.serviceId }).catch(() => setError('Could not stop remote preview'));
      }}>Stop</Button>}
      <Button disabled={!enabled} onClick={() => void window.electronAPI.remotePreviewWatch({ workspaceId, consumerId: consumer.current, enabled: true, refresh: true }).catch(() => setError('Could not discover remote services'))}>Detect services</Button>
      <Button onClick={() => setManual(!manual)}>Forward port manually…</Button>
      {forward && <span role="status">{forward.status === 'waiting' ? `Waiting for remote service on port ${forward.remotePort}…` : forward.status === 'active' ? `Ready on port ${forward.remotePort}` : forward.status}</span>}
    </div>
    {manual && <form className="remote-preview-controls" onSubmit={(event) => {
      event.preventDefault(); const port = Number(remotePort);
      if (!isPreviewPort(port)) { setError('Port must be a whole number from 1024 to 65535'); return; }
      manualChoice.current = true; void start.current({ remotePort: port, protocol });
    }}>
      <label>Remote port <Input aria-label="Remote preview port" type="number" min="1024" max="65535" value={remotePort} onChange={(event) => setRemotePort(event.target.value)} /></label>
      <Select aria-label="Preview protocol" value={protocol} onChange={(event) => setProtocol(event.target.value as 'http' | 'https')}><option value="http">HTTP</option><option value="https">HTTPS</option></Select>
      <Button type="submit" disabled={busy}>Forward and open</Button>
    </form>}
    {(error || forward?.error || state.error) && <div className="browser-annotation-error" role="alert">{error || forward?.error || state.error}</div>}
    {chosen && 'confidence' in chosen && chosen.confidence === 'unscoped' && <span>Could not determine whether this service belongs to the current workspace</span>}
  </div>;
}
