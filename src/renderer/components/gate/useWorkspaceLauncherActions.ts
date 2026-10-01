import { useCallback, useRef, useState } from 'react';
import type { WorkspaceRecipe, RecipeLaunchResult } from '../../../shared/types/recipes';
import type { WorkspaceTerminalLaunch } from '../../lib/workspaceLaunchPlan';
import { isSameWorkspaceIdentity } from '../../../shared/workspaceIdentity';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { WorkspaceFormData } from '../WorkspaceGateContent';

export type SelectWorkspace = (path: string, terminalCount: number, harness: string, model?: string,
  closeGate?: boolean, environmentId?: string, environmentLabel?: string,
  terminalLaunches?: WorkspaceTerminalLaunch[]) => Promise<boolean> | boolean | void;

interface Props {
  onWorkspaceSelect: SelectWorkspace;
  onLaunchRecipe?: (recipe: WorkspaceRecipe) => Promise<RecipeLaunchResult | null | void>;
  onClose?: () => void;
  selectExisting?: boolean;
}

/** Both launcher shells share submission, busy guards, error reporting, and recipe execution. */
export function useWorkspaceLauncherActions({ onWorkspaceSelect, onLaunchRecipe, onClose, selectExisting = false }: Props) {
  const [openError, setOpenError] = useState('');
  const [opening, setOpening] = useState(false);
  const [launchingRecipeId, setLaunchingRecipeId] = useState<string>();
  const openingRef = useRef(false);
  const requestRef = useRef(0);
  const clearOpenError = useCallback(() => { requestRef.current += 1; setOpenError(''); }, []);
  const workspaceError = 'Could not open this workspace. Check that its directory exists and is accessible.';

  const handleSubmit = async (data: WorkspaceFormData) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    clearOpenError();
    const requestId = requestRef.current;
    try {
      if (selectExisting) {
        const state = useWorkspaceStore.getState();
        const existing = state.workspaces.find((workspace) => isSameWorkspaceIdentity(
          { environmentId: workspace.environmentId || 'local', path: workspace.workspacePath },
          { environmentId: data.environmentId || 'local', path: data.path },
        ));
        if (existing) { state.selectWorkspace(existing.id); onClose?.(); return; }
      }
      const opened = data.terminalLaunches
        ? await onWorkspaceSelect(data.path, data.terminalCount, data.harness, data.model, true,
            data.environmentId, data.environmentLabel, data.terminalLaunches)
        : data.environmentId && data.environmentId !== 'local'
          ? await onWorkspaceSelect(data.path, data.terminalCount, data.harness, data.model, true,
              data.environmentId, data.environmentLabel)
          : await onWorkspaceSelect(data.path, data.terminalCount, data.harness, data.model);
      if (requestId !== requestRef.current) return;
      if (opened === false) setOpenError(workspaceError);
      else onClose?.();
    } catch {
      if (requestId === requestRef.current) setOpenError(workspaceError);
    } finally { openingRef.current = false; setOpening(false); }
  };

  const handleLaunchRecipe = async (recipe: WorkspaceRecipe) => {
    if (openingRef.current || !onLaunchRecipe) return;
    openingRef.current = true;
    setOpening(true);
    setLaunchingRecipeId(recipe.id);
    clearOpenError();
    const requestId = requestRef.current;
    try {
      const result = await onLaunchRecipe(recipe);
      if (requestId === requestRef.current) {
        if (result && !result.success) {
          const failures = result.steps.filter((step) => step.status === 'failed').map((step) => step.error).filter(Boolean);
          setOpenError(failures.join(' ') || 'Could not launch this recipe.');
        } else onClose?.();
      }
      return result;
    } catch (error) {
      if (requestId === requestRef.current) setOpenError(error instanceof Error ? error.message : 'Could not launch this recipe.');
    } finally { openingRef.current = false; setOpening(false); setLaunchingRecipeId(undefined); }
  };

  return { opening, launchingRecipeId, openError, onTargetChange: clearOpenError,
    onSubmit: handleSubmit, onLaunchRecipe: onLaunchRecipe ? handleLaunchRecipe : undefined };
}
