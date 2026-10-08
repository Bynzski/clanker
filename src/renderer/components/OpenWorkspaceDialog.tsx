import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, FolderOpen, Settings, X } from 'lucide-react';
import type { WorkspaceLocation, SshEnvironmentConfig } from '../../shared/types/environments';
import { Dialog, DialogContent, DialogTitle, DialogClose } from './ui/Dialog';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { IconButton } from './ui/IconButton';
import { WorkspaceTargetPicker } from './workspaceOpen/WorkspaceTargetPicker';
import RemoteWorkspacePath from './RemoteWorkspacePath';
import SshEnvironmentManager from './SshEnvironmentManager';
import { clankerMascot } from '../lib/branding';
import DirectorySuggestionList from './DirectorySuggestionList';
import { useDirectorySuggestions, withTrailingSlash, withoutTrailingSlash } from '../lib/useDirectorySuggestions';
import './WorkspaceLocation.css';
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
  const [startSaved, setStartSaved] = useState(false);
  const editedRef = useRef(false);
  const [localFocused, setLocalFocused] = useState(false);
  const listLocal = useCallback((directory: string) => window.electronAPI.readDirectory(directory)
    .then((entries) => entries.filter((entry) => entry.isDirectory).map((entry) => ({ name: entry.name, path: `${directory.replace(/\/$/, '')}/${entry.name}` }))), []);
  const localSuggestionPath = environmentId === 'local' && (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) ? path.replace(/\\/g, '/') : '';
  const local = useDirectorySuggestions(localSuggestionPath, localFocused, listLocal);
  useEffect(() => {
    mounted.current = true;
    void window.electronAPI.sshEnvironmentList().then((list) => { if (mounted.current) setEnvironments(list); })
      .catch((reason: unknown) => { if (mounted.current) setError(String(reason)); });
    // Local starting directory (the saved base directory) pre-fills the box, like a remote host's default root.
    void window.electronAPI.getBaseDirectory().then((base) => { if (mounted.current && base && !editedRef.current) setPath(base); }).catch(() => undefined);
    return () => { mounted.current = false; };
  }, []);
  const selectFolder = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const selected = await window.electronAPI.openDirectoryDialog();
      if (selected && mounted.current) { editedRef.current = true; setStartSaved(false); setPath(selected); }
    } catch (reason) { if (mounted.current) setError(String(reason)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const setStartingDirectory = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      if (environmentId === 'local') {
        const chosen = await window.electronAPI.openBaseDirectoryDialog();
        if (chosen && mounted.current) { editedRef.current = true; setPath(chosen); setStartSaved(true); }
      } else {
        const environment = environments.find((entry) => entry.id === environmentId);
        const root = withoutTrailingSlash(path.trim());
        if (!environment || !root.startsWith('/')) throw new Error('Enter an absolute path to use as the starting directory.');
        const result = await window.electronAPI.sshEnvironmentSave({ ...environment, defaultWorkspaceRoot: root });
        if (!result.success || !result.config) throw new Error(result.error || 'Could not save the starting directory.');
        const saved = result.config;
        if (mounted.current) { setEnvironments((list) => list.map((entry) => entry.id === saved.id ? saved : entry)); setStartSaved(true); }
      }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const submit = async () => {
    if (busyRef.current) return;
    if (!path.trim()) { setError('Choose a workspace folder.'); return; }
    if (environmentId !== 'local' && !path.startsWith('/')) { setError('Remote path must be an absolute POSIX path starting with /.'); return; }
    busyRef.current = true; setBusy(true); setError('');
    try {
      await onOpen({ environmentId, path: environmentId === 'local' && !path.trim().startsWith('/') ? path.trim() : withoutTrailingSlash(path.trim()) });
      if (mounted.current) onClose();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  return <div className="open-workspace-form" aria-busy={busy}>
    <div className="open-workspace-hero">
      <img src={clankerMascot} alt="" width={96} height={96} draggable={false} />
      <p>Where are we working today?</p>
    </div>
    <WorkspaceTargetPicker value={environmentId} environments={environments} disabled={busy}
      onSelect={(id) => { local.wake(); setEnvironmentId(id); setPath(''); setError(''); setStartSaved(false); editedRef.current = id !== 'local'; }}
      onAddServer={() => setManager(null)} onSettings={() => setManager(environmentId)} />
    {environmentId === 'local' ? <div className="remote-path-field"><div className="input-wrapper">
      <IconButton type="button" className="cog-button start-button" disabled={busy} aria-label="Set starting directory"
      title={environmentId === 'local' ? 'Choose the folder this dialog starts in' : 'Save this path as the starting directory for this server'}
      onClick={() => { void setStartingDirectory(); }}>
      {startSaved ? <Check size={16} /> : <Settings size={16} />}
    </IconButton>
      <Input variant="mono" type="text" className="workspace-location-input" aria-label="Local Directory Path" value={path}
        placeholder="Absolute directory" spellCheck={false} autoComplete="off" autoCapitalize="off" disabled={busy}
        onChange={(event) => { editedRef.current = true; setStartSaved(false); local.wake(); local.dismiss(); setPath(event.target.value); }}
        onClick={() => local.wake()}
        onFocus={() => { local.dismiss(); setLocalFocused(true); }} onBlur={() => { local.dismiss(); setLocalFocused(false); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && local.suggestions.length) { event.preventDefault(); local.dismiss(); }
          else if (event.key === 'ArrowDown' && local.settled) { event.preventDefault(); local.wake(); }
          else if (event.key === 'ArrowDown' && local.suggestions.length) { event.preventDefault(); local.setSelectedIndex((index) => (index + 1) % local.suggestions.length); }
          else if (event.key === 'ArrowUp' && local.suggestions.length) { event.preventDefault(); local.setSelectedIndex((index) => index <= 0 ? local.suggestions.length - 1 : index - 1); }
          else if (event.key === 'Enter') {
            event.preventDefault();
            const picked = local.suggestions[local.selectedIndex];
            if (picked) { local.settle(); setPath(withTrailingSlash(picked.path)); } else void submit();
          }
        }} />
      <IconButton type="button" className="cog-button" disabled={busy} aria-label="Choose Folder…" title="Choose Folder…" onClick={() => { void selectFolder(); }}>
        <FolderOpen size={18} aria-hidden="true" />
      </IconButton>
    </div>{localFocused && <DirectorySuggestionList suggestions={local.suggestions} selectedIndex={local.selectedIndex} onHover={local.setSelectedIndex}
      onChoose={(entry) => { local.settle(); setPath(withTrailingSlash(entry.path)); }} />}</div> : <fieldset disabled={busy}>
      <RemoteWorkspacePath key={environmentId} environmentId={environmentId} path={path}
        onPathChange={(next) => { setStartSaved(false); setPath(next); }} onSubmit={() => { void submit(); }}
        leadingAction={<IconButton type="button" className="cog-button start-button" disabled={busy} aria-label="Set starting directory"
        title={environmentId === 'local' ? 'Choose the folder this dialog starts in' : 'Save this path as the starting directory for this server'}
        onClick={() => { void setStartingDirectory(); }}>
        {startSaved ? <Check size={16} /> : <Settings size={16} />}
    </IconButton>} />
    </fieldset>}
    {error && <p role="alert" className="open-workspace-error">{error}</p>}
    <Button type="button" variant="primary" className="open-workspace-submit" disabled={busy || !path.trim()} onClick={() => { void submit(); }}>
      {busy ? 'Opening…' : <>Open Workspace <ArrowRight size={14} aria-hidden="true" /></>}
    </Button>
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
