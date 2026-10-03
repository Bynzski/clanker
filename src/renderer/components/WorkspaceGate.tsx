import { clankerUi16, clankerUi18, clankerUi32, clankerUi36 } from '../lib/branding';
import { X } from 'lucide-react';
import WindowControls from './WindowControls';
import WorkspaceGateContent from './WorkspaceGateContent';
import { Dialog, DialogContent, DialogTitle, DialogClose } from './ui/Dialog';
import { IconButton } from './ui/IconButton';
import { useWorkspaceLauncherActions } from './gate/useWorkspaceLauncherActions';
import type { SelectWorkspace } from './gate/useWorkspaceLauncherActions';
import type { WorkspaceRecipe, RecipeLaunchResult } from '../../shared/types/recipes';
import './WorkspaceGate.css';

interface LauncherProps {
  onWorkspaceSelect: SelectWorkspace;
  onLaunchRecipe?: (recipe: WorkspaceRecipe) => Promise<RecipeLaunchResult | null | void>;
}
interface Props extends LauncherProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WorkspaceGateModal({ isOpen, onClose, onWorkspaceSelect, onLaunchRecipe }: Props) {
  const actions = useWorkspaceLauncherActions({ onWorkspaceSelect, onLaunchRecipe, onClose, selectExisting: true });
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="modal-content" overlayClassName="modal-overlay" aria-describedby={undefined}>
        <div className="modal-header clanker-dialog-header">
          <DialogTitle asChild><span className="modal-title clanker-dialog-title">
            <img src={clankerUi16} srcSet={`${clankerUi16} 1x, ${clankerUi32} 2x`} alt="" width={16} height={16} className="modal-title-icon" />
            New Workspace
          </span></DialogTitle>
          <DialogClose asChild><IconButton variant="ghost" className="modal-close clanker-dialog-close" title="Close (Esc)" aria-label="Close">
            <X size={14} strokeWidth={2} />
          </IconButton></DialogClose>
        </div>
        <WorkspaceGateContent fullscreen={false} {...actions} />
      </DialogContent>
    </Dialog>
  );
}

function GateTitleBar() {
  return (
    <div className="workspace-gate-titlebar">
      <div className="workspace-gate-brand">
        <img
          src={clankerUi18}
          srcSet={`${clankerUi18} 1x, ${clankerUi36} 2x`}
          alt=""
          width={18}
          height={18}
        />
        <span className="workspace-gate-title">Clanker Grid</span>
      </div>

      <WindowControls className="workspace-gate-window-controls"
        buttonClassName="workspace-gate-window-btn" closeClassName="close" />
    </div>
  );
}

export function WorkspaceGateFullscreen({ onWorkspaceSelect, onLaunchRecipe }: LauncherProps) {
  const actions = useWorkspaceLauncherActions({ onWorkspaceSelect, onLaunchRecipe });
  return (
    <div className="workspace-gate">
      <GateTitleBar />
      <div className="workspace-gate-shell">
        <WorkspaceGateContent fullscreen {...actions} />
      </div>
    </div>
  );
}
