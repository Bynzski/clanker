import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { WorkspaceLocation, SshEnvironmentConfig } from '../../shared/types/environments';
import { Dialog, DialogContent, DialogTitle, DialogClose } from './ui/Dialog';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { WorkspaceTargetPicker } from './workspaceOpen/WorkspaceTargetPicker';
import RemoteWorkspacePath from './RemoteWorkspacePath';
import SshEnvironmentManager from './SshEnvironmentManager';
import './OpenWorkspaceDialog.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOpen: (location: WorkspaceLocation) => Promise<unknown>;
}

function WorkspaceLocationForm({ onClose, onOpen }: Omit<Props, 'isOpen'>) {
  const [environments, setEnvironments] = useState<SshEnvironmentConfig[]>([]);
  const [environmentId, setEnvironmentId] = useState('local');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [error, setError] = useState('');
  const [manager, setManager] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    void window.electronAPI.sshEnvironmentList().then((list) => { if (mounted.current) setEnvironments(list); })
      .catch((reason: unknown) => { if (mounted.current) setError(String(reason)); });
    return () => { mounted.current = false; };
  }, []);
  const selectFolder = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const selected = await window.electronAPI.openDirectoryDialog();
      if (selected && mounted.current) setPath(selected);
    } catch (reason) { if (mounted.current) setError(String(reason)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const submit = async () => {
    if (busyRef.current) return;
    if (!path.trim()) { setError('Choose a workspace folder.'); return; }
    if (environmentId !== 'local' && !path.startsWith('/')) { setError('Remote path must be an absolute POSIX path starting with /.'); return; }
    busyRef.current = true; setBusy(true); setError('');
    try {
      await onOpen({ environmentId, path: path.trim() });
      if (mounted.current) onClose();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  return <div className="open-workspace-form" aria-busy={busy}>
    <WorkspaceTargetPicker value={environmentId} environments={environments} disabled={busy}
      onSelect={(id) => { setEnvironmentId(id); setPath(''); setError(''); }}
      onAddServer={() => setManager(null)} onSettings={() => setManager(environmentId)} />
    {environmentId === 'local' ? <>
      <Button type="button" disabled={busy} onClick={() => { void selectFolder(); }}>Choose Folder…</Button>
      {path && <p className="open-workspace-path" title={path}>{path}</p>}
    </> : <fieldset disabled={busy}>
      <RemoteWorkspacePath key={environmentId} environmentId={environmentId} path={path} onPathChange={setPath} onSubmit={() => { void submit(); }} />
    </fieldset>}
    {error && <p role="alert" className="open-workspace-error">{error}</p>}
    <Button type="button" disabled={busy || !path.trim()} onClick={() => { void submit(); }}>{busy ? 'Opening…' : 'Open Workspace'}</Button>
    {manager !== undefined && <SshEnvironmentManager environments={environments} initialEnvironment={environments.find((env) => env.id === manager)}
      onClose={() => setManager(undefined)} onSaved={(config) => {
        setEnvironments((list) => [...list.filter((env) => env.id !== config.id), config]);
        setEnvironmentId(config.id); setPath(''); setManager(undefined);
      }} onDeleted={(id) => {
        setEnvironments((list) => list.filter((env) => env.id !== id));
        if (environmentId === id) { setEnvironmentId('local'); setPath(''); }
        setManager(undefined);
      }} />}
  </div>;
}
export default function OpenWorkspaceDialog({ isOpen, onClose, onOpen }: Props) {
  return <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="open-workspace-dialog" aria-describedby={undefined}>
      <div className="clanker-dialog-header">
        <DialogTitle className="clanker-dialog-title">Open Workspace</DialogTitle>
        <DialogClose asChild><IconButton variant="ghost" aria-label="Close"><X size={14} /></IconButton></DialogClose>
      </div>
      <WorkspaceLocationForm onClose={onClose} onOpen={onOpen} />
    </DialogContent>
  </Dialog>;
}
