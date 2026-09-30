import { useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react';
import WindowControls from './WindowControls';
import { useWorkspaceStore } from '../store/workspaceStore';
import WorkspaceGateContent, { WorkspaceFormData } from './WorkspaceGateContent';
import { isSameWorkspaceIdentity } from '../../shared/workspaceIdentity';
import { Dialog, DialogContent, DialogTitle, DialogClose } from './ui/Dialog';
import { IconButton } from './ui/IconButton';
import './WorkspaceGate.css';
import type { WorkspaceRecipe, RecipeLaunchResult } from '../../shared/types/recipes';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onWorkspaceSelect: (
    path: string,
    terminalCount: number,
    harness: string,
    model?: string,
    closeGate?: boolean,
    environmentId?: string,
    environmentLabel?: string
  ) => Promise<boolean> | boolean | void;
  onLaunchRecipe?: (recipe: WorkspaceRecipe) => Promise<RecipeLaunchResult | null | void>;
}

export function WorkspaceGateModal({ isOpen, onClose, onWorkspaceSelect, onLaunchRecipe }: Props) {
  const [openError, setOpenError] = useState('');
  const openRequestRef = useRef(0);
  const clearOpenError = useCallback(() => {
    openRequestRef.current += 1;
    setOpenError('');
  }, []);
  const handleSubmit = async (data: WorkspaceFormData) => {
    clearOpenError();
    const requestId = openRequestRef.current;
    const state = useWorkspaceStore.getState();
    const targetEnvId = data.environmentId || 'local';
    const open = state.workspaces.find((workspace) =>
      isSameWorkspaceIdentity({ environmentId: workspace.environmentId || 'local', path: workspace.workspacePath }, { environmentId: targetEnvId, path: data.path })
    );
    if (open) {
      state.selectWorkspace(open.id);
      onClose();
      return;
    }
    try {
      const opened = (data.environmentId && data.environmentId !== 'local')
        ? await onWorkspaceSelect(
            data.path,
            data.terminalCount,
            data.harness,
            data.model,
            true,
            data.environmentId,
            data.environmentLabel
          )
        : await onWorkspaceSelect(
            data.path,
            data.terminalCount,
            data.harness,
            data.model
          );
      if (requestId !== openRequestRef.current) return;
      if (opened === false) setOpenError('Could not open this workspace. Check that its directory exists and is accessible.');
      else onClose();
    } catch {
      if (requestId === openRequestRef.current) setOpenError('Could not open this workspace. Check that its directory exists and is accessible.');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="modal-content" overlayClassName="modal-overlay" aria-describedby={undefined}>
        <div className="modal-header">
          <DialogTitle asChild><span className="modal-title">
            <img src="./titlebar-icon.png" alt="" width={16} height={16} className="modal-title-icon" />
            New Workspace
          </span></DialogTitle>
          <DialogClose asChild><IconButton className="modal-close" title="Close (Esc)" aria-label="Close">
            <X size={16} strokeWidth={2} />
          </IconButton></DialogClose>
        </div>
        <WorkspaceGateContent
          onSubmit={handleSubmit}
          openError={openError}
          onTargetChange={clearOpenError}
          onLaunchRecipe={onLaunchRecipe ? async (recipe) => {
            const res = await onLaunchRecipe(recipe);
            if (res && res.success) {
              onClose();
            }
            return res;
          } : undefined}
        />
      </DialogContent>
    </Dialog>
  );
}

// Fullscreen gate version for initial launch
interface FullscreenGateProps {
  onWorkspaceSelect: (
    path: string,
    terminalCount: number,
    harness: string,
    model?: string,
    closeGate?: boolean,
    environmentId?: string,
    environmentLabel?: string
  ) => Promise<boolean> | boolean | void;
  onLaunchRecipe?: (recipe: WorkspaceRecipe) => Promise<RecipeLaunchResult | null | void>;
}

function GateTitleBar() {
  return (
    <div className="workspace-gate-titlebar">
      <div className="workspace-gate-brand">
        <img
          src="./titlebar-icon.png"
          alt="Clanker Grid icon"
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

export function WorkspaceGateFullscreen({ onWorkspaceSelect, onLaunchRecipe }: FullscreenGateProps) {
  const [openError, setOpenError] = useState('');
  const openRequestRef = useRef(0);
  const clearOpenError = useCallback(() => {
    openRequestRef.current += 1;
    setOpenError('');
  }, []);
  const handleSubmit = async (data: WorkspaceFormData) => {
    clearOpenError();
    const requestId = openRequestRef.current;
    try {
      const opened = (data.environmentId && data.environmentId !== 'local')
        ? await onWorkspaceSelect(
            data.path,
            data.terminalCount,
            data.harness,
            data.model,
            true,
            data.environmentId,
            data.environmentLabel
          )
        : await onWorkspaceSelect(
            data.path,
            data.terminalCount,
            data.harness,
            data.model
          );
      if (requestId === openRequestRef.current && opened === false) setOpenError('Could not open this workspace. Check that its directory exists and is accessible.');
    } catch {
      if (requestId === openRequestRef.current) setOpenError('Could not open this workspace. Check that its directory exists and is accessible.');
    }
  };

  return (
    <div className="workspace-gate">
      <GateTitleBar />
      <div className="workspace-gate-shell">
        <WorkspaceGateContent onSubmit={handleSubmit} onLaunchRecipe={onLaunchRecipe} openError={openError} onTargetChange={clearOpenError} />
      </div>
    </div>
  );
}
