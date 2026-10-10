import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from '../ui/AlertDialog';
import { Button } from '../ui/Button';

/** Explicit credential/target removal; the caller owns the captured identity and mutation. */
export default function SettingsDeleteConfirmation({ title, description, onCancel, onConfirm }: {
  title: string; description: string; onCancel: () => void; onConfirm: () => void;
}) {
  return <AlertDialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
    <AlertDialogContent onBackdropCancel={onCancel}>
      <div className="clanker-dialog-header"><AlertDialogTitle className="clanker-dialog-title">{title}</AlertDialogTitle></div>
      <AlertDialogDescription className="clanker-dialog-body">{description}</AlertDialogDescription>
      <div className="clanker-dialog-footer">
        <AlertDialogCancel asChild><Button>Cancel</Button></AlertDialogCancel>
        <AlertDialogAction asChild><Button variant="danger" onClick={onConfirm}>Delete</Button></AlertDialogAction>
      </div>
    </AlertDialogContent>
  </AlertDialog>;
}
