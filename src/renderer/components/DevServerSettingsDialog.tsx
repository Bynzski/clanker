import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { DevServiceCommand } from '../../shared/types/workspaceServices';
import { parseDevServiceEnvironment } from '../../shared/devServiceEnvironment';
import { Dialog, DialogContent, DialogClose, DialogDescription, DialogTitle } from './ui/Dialog';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import './DevServerSettingsDialog.css';

export default function DevServerSettingsDialog({ command, terminalId, onClose, onSaved }: {
  command: DevServiceCommand; terminalId: string; onClose: () => void; onSaved: () => void;
}) {
  const [text, setText] = useState('');
  const [expected, setExpected] = useState<DevServiceCommand>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let disposed = false;
    void window.electronAPI.workspaceServiceDiscover({ workspaceId: command.workspaceId, terminalId }).then((result) => {
      if (disposed) return;
      if (!result.success || !result.command) throw new Error(result.error || 'Dev command is no longer available');
      if (result.command.checkoutContextId !== command.checkoutContextId || result.command.cwd !== command.cwd || result.command.command !== command.command) throw new Error('Terminal checkout or command changed; reopen settings');
      setExpected(result.command);
      setText(Object.entries(result.environment ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'));
    }).catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : 'Could not load settings'); });
    return () => { disposed = true; };
  }, [command.workspaceId, command.checkoutContextId, command.cwd, command.command, terminalId]);
  const save = async () => {
    if (!expected) return;
    setBusy(true); setError(undefined);
    try {
      const environment = parseDevServiceEnvironment(text);
      const result = await window.electronAPI.workspaceServiceSaveSettings({ workspaceId: expected.workspaceId, terminalId,
        checkoutContextId: expected.checkoutContextId, cwd: expected.cwd, command: expected.command, settingsRevision: expected.settingsRevision, environment });
      if (!result.success) throw new Error(result.error || 'Could not save settings');
      onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save settings'); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="dev-settings-dialog">
      <div className="clanker-dialog-header">
        <DialogTitle className="clanker-dialog-title">Checkout dev server settings</DialogTitle>
        <DialogClose asChild><IconButton variant="ghost" disabled={busy} aria-label="Close"><X size={14} /></IconButton></DialogClose>
      </div>
      <div className="clanker-dialog-body dev-settings-body">
        <DialogDescription>Non-secret environment variables for this checkout’s dev command only. Saved locally across restarts; no project files are changed. Save does not start the server.</DialogDescription>
        <code className="dev-settings-root">{command.cwd}</code>
        <label htmlFor="dev-server-environment">Environment (NAME=value, one per line)</label>
        <textarea id="dev-server-environment" value={text} onChange={(event) => setText(event.target.value)} disabled={!expected || busy} maxLength={12288} spellCheck={false} placeholder={'PORT=8788\nVITE_DEV_PORT=5174'} />
        <p>Values are literal: no quotes, expansion or shell execution. Your project must read these variables and connect its frontend proxy to the matching backend. Clanker does not assign ports automatically. Toolchain overrides are blocked. Do not store tokens or passwords here.</p>
        {error && <div role="alert">{error}</div>}
      </div>
      <div className="clanker-dialog-footer">
        <Button variant="secondary" size="sm" disabled={!expected || busy} onClick={() => setText('')}>Clear variables</Button>
        <DialogClose asChild><Button variant="secondary" size="sm" disabled={busy}>Cancel</Button></DialogClose>
        <Button size="sm" disabled={!expected || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save settings'}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
