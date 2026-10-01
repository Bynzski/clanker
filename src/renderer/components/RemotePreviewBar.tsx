import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { useEffect, useRef, useState } from 'react';
import { isPreviewPort, type RemotePreviewState } from '../../shared/types/remotePreview';

export default function RemotePreviewBar({ workspaceId, onOpen, onLayoutChange }: {
  workspaceId: string;
  onOpen: (url: string) => Promise<unknown>;
  onLayoutChange: () => void;
}) {
  const [remotePort, setRemotePort] = useState('3000');
  const [localPort, setLocalPort] = useState('3000');
  const [forward, setForward] = useState<RemotePreviewState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const updateRevision = useRef(0);
  const latestForward = useRef<RemotePreviewState | null>(null);
  const latestOnOpen = useRef(onOpen);
  useEffect(() => { latestOnOpen.current = onOpen; }, [onOpen]);
  useEffect(() => {
    const current = ++generation.current;
    let receivedUpdate = false;
    setForward(null);
    setError('');
    setBusy(false);
    const unsubscribe = window.electronAPI.onRemotePreviewChanged((update) => {
      if (generation.current !== current || update.workspaceId !== workspaceId) return;
      receivedUpdate = true;
      updateRevision.current++;
      latestForward.current = update.forward;
      setForward(update.forward);
      setError(update.forward?.error ?? '');
    });
    void window.electronAPI.remotePreviewGet({ workspaceId }).then((state) => {
      if (generation.current !== current || receivedUpdate) return;
      setForward(state);
      setError(state?.error ?? '');
      if (state) { setRemotePort(String(state.remotePort)); setLocalPort(String(state.localPort)); }
    }).catch(() => { if (generation.current === current) setError('Could not load remote preview state'); });
    return () => { generation.current = current + 1; unsubscribe(); };
  }, [workspaceId]);
  useEffect(() => { onLayoutChange(); }, [error, forward?.status, onLayoutChange]);
  const locked = busy || forward?.status === 'starting' || forward?.status === 'active' || forward?.status === 'stopping';
  const start = async () => {
    const remote = Number(remotePort), local = Number(localPort);
    if (!isPreviewPort(remote) || !isPreviewPort(local)) { setError('Ports must be whole numbers from 1024 to 65535'); return; }
    const current = generation.current;
    const revision = updateRevision.current;
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.remotePreviewStart({ workspaceId, remotePort: remote, localPort: local });
      if (generation.current !== current) return;
      if (updateRevision.current !== revision && (!latestForward.current || latestForward.current.status === 'error' || latestForward.current.status === 'stopping')) return;
      setForward(result.forward);
      setError(result.error ?? '');
      if (result.success && result.forward?.status === 'active') await latestOnOpen.current(result.forward.url);
    } catch (cause) { if (generation.current === current) setError(cause instanceof Error ? cause.message : 'Could not start remote preview'); }
    finally { if (generation.current === current) setBusy(false); }
  };
  const stop = async () => {
    const current = generation.current;
    setBusy(true);
    try {
      if (!await window.electronAPI.remotePreviewStop({ workspaceId })) throw new Error('Could not stop remote preview');
      if (generation.current === current) { setForward(null); setError(''); }
    } catch (cause) { if (generation.current === current) setError(cause instanceof Error ? cause.message : 'Could not stop remote preview'); }
    finally { if (generation.current === current) setBusy(false); }
  };
  return <div className="remote-preview-bar">
    <div className="remote-preview-controls">
      <span>SSH preview</span>
      <label>Remote port <Input aria-label="Remote preview port" type="number" min="1024" max="65535" value={remotePort} disabled={locked} onChange={(event) => setRemotePort(event.target.value)} /></label>
      <label>Local port <Input aria-label="Local preview port" type="number" min="1024" max="65535" value={localPort} disabled={locked} onChange={(event) => setLocalPort(event.target.value)} /></label>
      <Button type="button" disabled={Boolean(locked)} onClick={() => void start()}>{forward?.status === 'error' ? 'Retry preview' : 'Start preview'}</Button>
      {forward && <Button type="button" disabled={busy || forward.status === 'stopping'} onClick={() => void stop()}>Stop preview</Button>}
      {forward?.status === 'active' && <Button type="button" onClick={() => void onOpen(forward.url)}>Open preview</Button>}
      {forward && <span role="status">{forward.status === 'active' ? `${forward.url} → remote 127.0.0.1:${forward.remotePort}` : forward.status}</span>}
    </div>
    {error && <div className="browser-annotation-error" role="alert">{error}</div>}
  </div>;
}
