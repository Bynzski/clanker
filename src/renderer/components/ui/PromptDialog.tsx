import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from './AlertDialog';
import { Button } from './Button';

export interface PromptOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  workspaceId?: string;
}

/** Safe action receives initial focus. Escape cancels; backdrop never confirms or dismisses. */
export function PromptDialog({ title, description, confirmLabel, cancelLabel = 'Cancel', variant = 'danger',
  workspaceId, onAnswer, busy = false, confirmDisabled = false }: PromptOptions & { onAnswer: (answer: boolean) => void; busy?: boolean; confirmDisabled?: boolean }) {
  return <AlertDialog open onOpenChange={(open) => { if (!open && !busy) onAnswer(false); }}>
    <AlertDialogContent className="clanker-prompt" workspaceId={workspaceId} style={{ width: 440 }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
      <div className="clanker-dialog-header"><AlertDialogTitle className="clanker-dialog-title">{title}</AlertDialogTitle></div>
      <AlertDialogDescription className="clanker-dialog-body">{description}</AlertDialogDescription>
      <div className="clanker-dialog-footer">
        <AlertDialogCancel asChild><Button disabled={busy}>{confirmLabel ? cancelLabel : 'OK'}</Button></AlertDialogCancel>
        {confirmLabel && <Button variant={variant} disabled={busy || confirmDisabled} onClick={() => onAnswer(true)}>{confirmLabel}</Button>}
      </div>
    </AlertDialogContent>
  </AlertDialog>;
}
