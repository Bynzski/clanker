import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAgentAttentionStore } from '../store/agentAttentionStore';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';
import { getWorkspaceProjectName } from '../lib/workspaceLabels';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from './ui/Dialog';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Textarea } from './ui/Textarea';
import './AnnotationHandoffDialog.css';
interface Props {
  sourceWorkspaceId: string;
  initialMessage: string;
  onClose: () => void;
}

export default function AnnotationHandoffDialog({ sourceWorkspaceId, initialMessage, onClose }: Props) {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const attentionByTerminalId = useAgentAttentionStore((state) => state.byTerminalId);
  const [handoffStatuses, setHandoffStatuses] = useState<Awaited<ReturnType<typeof window.electronAPI.getAgentHandoffStatuses>>>({});
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let active = true;
    void window.electronAPI.getAgentHandoffStatuses()
      .then((statuses) => { if (active) setHandoffStatuses(statuses); })
      .catch(() => { if (active) setHandoffStatuses({}); });
    return () => { active = false; };
  }, [attentionByTerminalId]);

  const candidates = workspaces.flatMap((workspace) => workspace.terminals
    .filter((terminal) => terminal.harnessId && workspace.panes.some((pane) => pane.terminalId === terminal.id))
    .map((terminal) => {
      const handoffState = handoffStatuses[terminal.id] ?? 'unavailable';
      const canSend = handoffState === 'ready' || handoffState === 'unverified';
      const status = handoffState === 'ready' ? 'Ready'
        : handoffState === 'unverified' ? 'Open · status unverified'
          : handoffState === 'provisional' ? 'Stopped · outcome unverified — continue or copy in the agent terminal'
          : handoffState === 'running' ? 'Running'
            : handoffState === 'needs_input' ? 'Needs input' : 'Unavailable';
      return { workspace, terminal, canSend, status };
    }))
    .sort((left, right) => Number(right.workspace.id === sourceWorkspaceId) - Number(left.workspace.id === sourceWorkspaceId));

  const copyMessage = async () => {
    try {
      const result = await window.electronAPI.writeClipboard(message);
      setFeedback(result.success ? 'Copied message to clipboard.' : result.error || 'Could not copy message.');
    } catch {
      setFeedback('Could not copy message.');
    }
  };

  const sendMessage = async (workspaceId: string, terminalId: string, name: string) => {
    setBusy(true);
    setFeedback('');
    try {
      const result = await window.electronAPI.sendAnnotationToAgent(workspaceId, terminalId, message);
      if (result.success) {
        onClose();
        return;
      }
      setFeedback(result.error || `Could not send to ${name}. Copy the message instead.`);
    } catch {
      setFeedback('Agent is unavailable. Copy the message instead.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="annotation-handoff-dialog"
        overlayClassName="annotation-handoff-overlay"
        workspaceId={sourceWorkspaceId}
      >
        <header className="annotation-handoff-header clanker-dialog-header">
          <DialogTitle asChild>
            <h2 className="clanker-dialog-title">Send annotation to agent</h2>
          </DialogTitle>
          <DialogClose asChild>
            <IconButton variant="ghost" className="clanker-dialog-close" aria-label="Close annotation handoff" title="Close"><X size={14} /></IconButton>
          </DialogClose>
        </header>
        <div className="annotation-handoff-body clanker-dialog-body">
          <DialogDescription asChild>
            <p className="annotation-handoff-description">Review the message and choose an open agent. Check the pane when status is unverified.</p>
          </DialogDescription>
          <label className="annotation-handoff-label" htmlFor="annotation-handoff-message">Message</label>
          <Textarea
            id="annotation-handoff-message"
            variant="mono"
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setFeedback('');
            }}
            autoFocus
            spellCheck={false}
          />
          <div className="annotation-handoff-destinations">
            <div className="annotation-handoff-label">Agents</div>
            {candidates.length === 0 && <p>No agent panes are open. Copy the message to use it elsewhere.</p>}
            {candidates.map(({ workspace, terminal, canSend, status }) => {
              const harnessName = HARNESS_OPTIONS.find((option) => option.id === terminal.harnessId)?.label ?? terminal.harnessId;
              const projectName = getWorkspaceProjectName(workspace);
              const destination = `${projectName}${workspace.gitCurrentBranch ? ` · ${workspace.gitCurrentBranch}` : ''}`;
              const name = terminal.displayName ?? harnessName ?? 'Agent';
              return (
                <div className="annotation-handoff-agent" key={terminal.id}>
                  <div>
                    <strong>{name}</strong><span> · {harnessName}</span>
                    <small>{destination} · {status}</small>
                    <small className="annotation-handoff-path" title={workspace.workspacePath}>{workspace.workspacePath}</small>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canSend || busy || !message.trim()}
                    onClick={() => void sendMessage(workspace.id, terminal.id, name)}
                  >
                    Send
                  </Button>
                </div>
              );
            })}
          </div>
          {feedback && <p className="annotation-handoff-feedback" role="status">{feedback}</p>}
        </div>
        <footer className="annotation-handoff-footer clanker-dialog-footer">
          <Button size="sm" variant="secondary" onClick={() => void copyMessage()} disabled={busy || !message}>
            Copy message
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
