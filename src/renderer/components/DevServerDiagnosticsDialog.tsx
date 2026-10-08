import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import type { WorkspaceService } from '../../shared/types/workspaceServices';
import { Dialog, DialogContent, DialogClose, DialogDescription, DialogTitle } from './ui/Dialog';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import './DevServerDiagnosticsDialog.css';

function describeServiceExit(service: WorkspaceService): string {
  return service.exitCode !== undefined ? `Exited with code ${service.exitCode}` : 'Failed';
}

/** Plain-text report meant to be pasted to an agent: what ran, where, and what it said. */
function buildDevServerReport(service: WorkspaceService): string {
  return [
    '## Dev server failure',
    `- Status: ${describeServiceExit(service)}`,
    `- Command: ${service.command}`,
    `- Directory: ${service.cwd}`,
    ...(service.pid !== undefined ? [`- PID: ${service.pid}`] : []),
    '',
    'Output:',
    '```',
    service.error?.trim() || '(no output captured)',
    '```',
  ].join('\n');
}

export default function DevServerDiagnosticsDialog({ service, open, onOpenChange }: {
  service: WorkspaceService; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    clearTimeout(timer.current);
    try { await navigator.clipboard.writeText(buildDevServerReport(service)); setCopied('ok'); }
    catch { setCopied('failed'); }
    timer.current = setTimeout(() => setCopied(null), 2000);
  };
  const rows: Array<[string, string]> = [['Status', describeServiceExit(service)], ['Command', service.command], ['Directory', service.cwd]];
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="dev-diagnostics-dialog">
      <div className="clanker-dialog-header">
        <DialogTitle className="clanker-dialog-title">Dev server failed</DialogTitle>
        <DialogClose asChild><IconButton variant="ghost" aria-label="Close"><X size={14} /></IconButton></DialogClose>
      </div>
      <div className="clanker-dialog-body dev-diagnostics-body">
        <DialogDescription className="sr-only">Command, directory and output of the failed dev server.</DialogDescription>
        <dl className="dev-diagnostics-facts">
          {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}
        </dl>
        <div className="dev-diagnostics-label">Output</div>
        <pre className="dev-diagnostics-output" tabIndex={0}>{service.error?.trim() || '(no output captured)'}</pre>
      </div>
      <div className="clanker-dialog-footer">
        <span className="dev-diagnostics-copied" role="status">{copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Could not copy' : ''}</span>
        <Button size="sm" onClick={() => void copy()}>{copied === 'ok' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />} Copy for agent</Button>
        <DialogClose asChild><Button size="sm" variant="secondary">Close</Button></DialogClose>
      </div>
    </DialogContent>
  </Dialog>;
}
