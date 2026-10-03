import { useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import type { SshEnvironmentConfig } from '../../shared/types/environments';
import { validateSshEnvironmentConfig } from '../../shared/sshValidation';
import { Dialog, DialogContent, DialogTitle, DialogClose } from './ui/Dialog';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Input } from './ui/Input';
import { Field, FieldLabel } from './ui/Field';
import './WorkspaceGate.css';
interface Props {
  environments: SshEnvironmentConfig[];
  initialEnvironment?: SshEnvironmentConfig;
  onSaved: (config: SshEnvironmentConfig) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}

export default function SshEnvironmentManager({ environments, initialEnvironment, onSaved, onDeleted, onClose }: Props) {
  const [editingId, setEditingId] = useState<string | null>(initialEnvironment?.id ?? null);
  const [label, setLabel] = useState(initialEnvironment?.label ?? '');
  const [target, setTarget] = useState(initialEnvironment?.target ?? '');
  const [root, setRoot] = useState(initialEnvironment?.defaultWorkspaceRoot ?? '');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | 'delete' | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setEditingId(null); setLabel(''); setTarget(''); setRoot(''); setError(''); setStatus(null);
  };
  const edit = (config: SshEnvironmentConfig) => {
    setEditingId(config.id); setLabel(config.label); setTarget(config.target);
    setRoot(config.defaultWorkspaceRoot ?? ''); setError(''); setStatus(null);
  };
  const save = async () => {
    if (busy) return;
    const validation = validateSshEnvironmentConfig({
      id: editingId ?? crypto.randomUUID(), kind: 'ssh', label, target, defaultWorkspaceRoot: root,
    });
    if (!validation.valid) { setError(validation.error); return; }
    setBusy('save'); setError('');
    try {
      const result = await window.electronAPI.sshEnvironmentSave(validation.config);
      if (!result.success || !result.config) { setError(result.error || 'Failed to save environment'); return; }
      onSaved(result.config);
      reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(null); }
  };
  const test = async () => {
    if (busy) return;
    if (!target.trim()) { setStatus({ success: false, message: 'Please enter an SSH target' }); return; }
    setBusy('test'); setStatus(null);
    try {
      const result = await window.electronAPI.sshEnvironmentTest(target.trim());
      setStatus({ success: result.success, message: result.success ? 'Connection successful!' : result.error || 'Connection failed' });
    } catch (reason) {
      setStatus({ success: false, message: reason instanceof Error ? reason.message : String(reason) });
    } finally { setBusy(null); }
  };
  const remove = async (id: string) => {
    if (busy) return;
    setBusy('delete'); setError('');
    try {
      const result = await window.electronAPI.sshEnvironmentDelete(id);
      if (!result.success) { setError(result.error || 'Failed to delete environment'); return; }
      onDeleted(id);
      if (editingId === id) reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(null); }
  };

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="ssh-manager-modal" overlayClassName="ssh-manager-overlay" aria-describedby={undefined}
      onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
      onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
      onOpenAutoFocus={(event) => { event.preventDefault(); labelRef.current?.focus(); }}>
      <div className="ssh-manager-header clanker-dialog-header">
        <DialogTitle asChild><span className="ssh-manager-title clanker-dialog-title">Manage SSH Targets</span></DialogTitle>
        <DialogClose asChild>
          <IconButton variant="ghost" className="clanker-dialog-close" aria-label="Close SSH target manager" title="Close" disabled={!!busy}><X size={14} /></IconButton>
        </DialogClose>
      </div>
      <div className="ssh-manager-body clanker-dialog-body">
        <form className="ssh-manager-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <span className="gate-section-label">{editingId ? 'Edit SSH Environment' : 'Add New SSH Environment'}</span>
          <Field className="ssh-form-row">
            <FieldLabel htmlFor="ssh-target-label">Label</FieldLabel>
            <Input ref={labelRef} id="ssh-target-label" size="sm" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. dev-vps" disabled={!!busy} />
          </Field>
          <Field className="ssh-form-row">
            <FieldLabel htmlFor="ssh-target-address">SSH Target</FieldLabel>
            <Input id="ssh-target-address" size="sm" value={target} onChange={(event) => { setTarget(event.target.value); setStatus(null); }} placeholder="e.g. user@192.168.1.100 or vps-host" disabled={!!busy} />
          </Field>
          <Field className="ssh-form-row">
            <FieldLabel htmlFor="ssh-target-root" optional>Default workspace root</FieldLabel>
            <Input id="ssh-target-root" size="sm" value={root} onChange={(event) => setRoot(event.target.value)} placeholder="e.g. /srv/repos" aria-describedby="ssh-root-help" disabled={!!busy} spellCheck={false} />
            <span id="ssh-root-help" className="ssh-env-target">Absolute remote path. If unavailable or blank, use ~/workspaces or ~.</span>
          </Field>
          {status && <p role="status" className={status.success ? 'ssh-manager-success' : 'ssh-manager-error'}>{status.message}</p>}
          {error && <p role="alert" className="ssh-manager-error">{error}</p>}
          <div className="ssh-form-actions">
            <Button size="sm" variant="secondary" onClick={() => void test()} disabled={!!busy}>{busy === 'test' ? 'Testing…' : 'Test Connection'}</Button>
            <Button size="sm" variant="primary" type="submit" disabled={!!busy}>{busy === 'save' ? 'Saving…' : editingId ? 'Save Changes' : 'Save Target'}</Button>
            {editingId && <Button size="sm" variant="secondary" onClick={reset} disabled={!!busy}>Cancel Edit</Button>}
          </div>
        </form>
        <div className="ssh-saved-list">
          <span className="gate-section-label">Saved Environments ({environments.length})</span>
          {!environments.length && <p className="ssh-env-target">No saved SSH environments yet.</p>}
          {environments.map((config) => <div key={config.id} className="ssh-env-item">
            <div className="ssh-env-info">
              <span className="ssh-env-label">{config.label}</span>
              <span className="ssh-env-target">{config.target}</span>
              {config.defaultWorkspaceRoot && <span className="ssh-env-target" title={config.defaultWorkspaceRoot}>{config.defaultWorkspaceRoot}</span>}
            </div>
            <div className="ssh-env-actions">
              <IconButton variant="ghost" type="button" className="ssh-env-edit-btn" onClick={() => edit(config)} disabled={!!busy} aria-label={`Edit ${config.label}`}><Pencil size={14} /></IconButton>
              <IconButton variant="danger" type="button" className="ssh-env-delete-btn" onClick={() => void remove(config.id)} disabled={!!busy} aria-label={`Delete ${config.label}`}><X size={14} /></IconButton>
            </div>
          </div>)}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
