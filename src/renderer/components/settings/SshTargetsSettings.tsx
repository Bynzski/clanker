import { useEffect, useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import type { SshEnvironmentConfig } from '../../../shared/types/environments';
import { validateSshEnvironmentConfig } from '../../../shared/sshValidation';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { Field, FieldLabel, FormMessage } from '../ui/Field';
import SettingsDeleteConfirmation from './SettingsDeleteConfirmation';
import './SshTargetsSettings.css';

/** Extracted manager: one page, existing authoritative IPC, no automatic connectivity checks. */
export default function SshTargetsSettings({ initialTargetId, onSaved, onDeleted, onBusyChange, onSelectionChange, focusOnLoad = true }: {
  focusOnLoad?: boolean; initialTargetId?: string | null; onSaved: (config: SshEnvironmentConfig) => void;
  onDeleted: (id: string) => void; onBusyChange: (busy: boolean) => void;
  onSelectionChange?: (id: string | null) => void;
}) {
  const [environments, setEnvironments] = useState<SshEnvironmentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const [root, setRoot] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null);
  const [deleting, setDeleting] = useState<SshEnvironmentConfig | null>(null);
  const alive = useRef(false);
  const lock = useRef(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const initialSelection = useRef(initialTargetId).current;
  const focusedOnLoad = useRef(false);
  const reset = () => { onSelectionChange?.(null); setEditingId(null); setLabel(''); setTarget(''); setRoot(''); setError(''); setStatus(''); };
  const edit = (config: SshEnvironmentConfig) => {
    onSelectionChange?.(config.id); setEditingId(config.id); setLabel(config.label); setTarget(config.target); setRoot(config.defaultWorkspaceRoot ?? ''); setError(''); setStatus('');
    labelRef.current?.focus();
  };
  const load = async (initialize = false) => {
    setLoading(true); setError('');
    try {
      const list = await window.electronAPI.sshEnvironmentList();
      if (!alive.current) return;
      setEnvironments(list);
      if (initialize && initialSelection) {
        const selected = list.find((entry) => entry.id === initialSelection);
        if (selected) edit(selected);
        else setError('The requested SSH target is no longer saved. Select a target or add one.');
      }
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Could not load SSH targets'); }
    finally { if (alive.current) setLoading(false); }
  };
  useEffect(() => { alive.current = true; void load(true); return () => { alive.current = false; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (loading || focusedOnLoad.current) return;
    focusedOnLoad.current = true;
    if (focusOnLoad && initialSelection !== undefined && document.activeElement?.getAttribute('role') !== 'searchbox') labelRef.current?.focus();
  }, [loading, initialSelection, focusOnLoad]);
  useEffect(() => { onBusyChange(!!busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  const run = async (operation: 'save' | 'test' | 'delete', deleted?: SshEnvironmentConfig) => {
    if (lock.current) return;
    const validation = operation !== 'delete' ? validateSshEnvironmentConfig({ id: editingId ?? crypto.randomUUID(), kind: 'ssh', label: label || 'Connection test', target, defaultWorkspaceRoot: root }) : null;
    if (validation && !validation.valid) { setError(validation.error); return; }
    lock.current = true; setBusy(operation); setError(''); setStatus('');
    try {
      if (operation === 'test') {
        const result = await window.electronAPI.sshEnvironmentTest(target.trim());
        if (!alive.current) return;
        if (!result.success) throw new Error(result.error || 'Connection failed');
        setStatus('Connection successful!');
      } else if (operation === 'save' && validation?.valid) {
        // Label is required for persistence even if omitted during a connection test.
        const savedValidation = validateSshEnvironmentConfig({ ...validation.config, label });
        if (!savedValidation.valid) throw new Error(savedValidation.error);
        const result = await window.electronAPI.sshEnvironmentSave(savedValidation.config);
        if (!alive.current) return;
        if (!result.success || !result.config) throw new Error(result.error || 'Failed to save environment');
        const config = result.config;
        setEnvironments((list) => [...list.filter((entry) => entry.id !== config.id), config]);
        onSaved(config); edit(config); setStatus('Target saved.');
      } else if (deleted) {
        const result = await window.electronAPI.sshEnvironmentDelete(deleted.id);
        if (!alive.current) return;
        if (!result.success) throw new Error(result.error || 'Failed to delete environment');
        setEnvironments((list) => list.filter((entry) => entry.id !== deleted.id));
        onDeleted(deleted.id);
        if (editingId === deleted.id) reset();
        setStatus('Target deleted.');
      }
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'SSH operation failed'); }
    finally { lock.current = false; if (alive.current) setBusy(null); }
  };
  return <div className="ssh-targets-settings" aria-busy={loading || !!busy}>
    {loading && <p role="status">Loading saved SSH targets…</p>}
    {error && <FormMessage variant="error">{error}</FormMessage>}
    {status && <p role="status">{status}</p>}
    <div className="ssh-targets-actions"><Button disabled={!!busy || loading} onClick={() => { reset(); labelRef.current?.focus(); }}>Add Target</Button><Button disabled={!!busy || loading} onClick={() => void load()}>Refresh Targets</Button></div>
    <form className="ssh-targets-form" onSubmit={(event) => { event.preventDefault(); void run('save'); }}>
      <h3 className="management-page-title">{editingId ? 'Edit SSH Environment' : 'Add New SSH Environment'}</h3>
      <Field><FieldLabel htmlFor="ssh-target-label">Label</FieldLabel><Input ref={labelRef} id="ssh-target-label" value={label} onChange={(event) => setLabel(event.target.value)} disabled={!!busy || loading} /></Field>
      <Field><FieldLabel htmlFor="setting-ssh-target">SSH Target</FieldLabel><Input id="setting-ssh-target" value={target} onChange={(event) => { setTarget(event.target.value); setStatus(''); }} placeholder="user@host or OpenSSH alias" disabled={!!busy || loading} /></Field>
      <Field><FieldLabel htmlFor="ssh-target-root" optional>Default workspace root</FieldLabel><Input id="ssh-target-root" value={root} onChange={(event) => setRoot(event.target.value)} disabled={!!busy || loading} aria-describedby="ssh-root-help" /></Field>
      <p id="ssh-root-help" className="management-page-description">Absolute remote POSIX path. Blank or inaccessible roots fall back to ~/workspaces or home. Opening this page does not connect to a server.</p>
      <div className="ssh-targets-actions"><Button disabled={!!busy || loading} onClick={() => void run('test')}>{busy === 'test' ? 'Testing…' : 'Test Connection'}</Button><Button variant="primary" type="submit" disabled={!!busy || loading}>{busy === 'save' ? 'Saving…' : editingId ? 'Save Changes' : 'Save Target'}</Button>{editingId && <Button disabled={!!busy || loading} onClick={reset}>Cancel Edit</Button>}</div>
    </form>
    <section aria-label="Saved SSH targets"><h3 className="management-page-title">Saved Environments ({environments.length})</h3>
      {!loading && !environments.length && <p>No saved SSH environments yet.</p>}
      {environments.map((config) => <div className="ssh-targets-row" key={config.id}>
        <div id={`ssh-target-info-${config.id}`}><strong>{config.label}</strong><p>{config.target}</p>{config.defaultWorkspaceRoot && <p>{config.defaultWorkspaceRoot}</p>}</div>
        <div className="ssh-targets-actions"><IconButton variant="ghost" disabled={!!busy || loading} aria-describedby={`ssh-target-info-${config.id}`} aria-label={`Edit ${config.label}`} onClick={() => edit(config)}><Pencil size={14} /></IconButton><IconButton variant="ghost" disabled={!!busy || loading} aria-describedby={`ssh-target-info-${config.id}`} aria-label={`Delete ${config.label}`} onClick={() => setDeleting(config)}><X size={14} /></IconButton></div>
      </div>)}
    </section>
    {deleting && <SettingsDeleteConfirmation title={`Delete SSH target ${deleting.label}?`} description={`Remove saved target ${deleting.target} (${deleting.id}). This does not disconnect or delete a workspace. Main refuses removal while the environment is in use.`} onCancel={() => setDeleting(null)} onConfirm={() => void run('delete', deleting)} />}
  </div>;
}
