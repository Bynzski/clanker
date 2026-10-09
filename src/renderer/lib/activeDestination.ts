/**
 * The active app destination and what it supports. A Workspace and an Assistant are peers for
 * navigation but have different capabilities; toolbar controls consult this instead of silently
 * targeting whichever workspace happens to be warm in the background.
 */
import { useAssistantNavStore } from '../store/assistantNavStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { WORKSPACE_RECIPES_ENABLED } from '../../shared/recipeAvailability';
import { assistantBrowserOwnerId } from '../../shared/browserOwner';

export type ActiveDestination =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'assistant'; assistantId: string }
  | { kind: 'none' };

export interface DestinationCapabilities {
  browser: boolean;
  explorer: boolean;
  notes: boolean;
  recipes: boolean;
  terminalLaunch: boolean;
  isolatedAgent: boolean;
  git: boolean;
  layout: boolean;
  sessionHistory: boolean;
  usage: boolean;
}

const WORKSPACE_CAPABILITIES: DestinationCapabilities = {
  browser: true, explorer: true, notes: true, recipes: WORKSPACE_RECIPES_ENABLED, terminalLaunch: true, isolatedAgent: true,
  git: true, layout: true, sessionHistory: true, usage: true,
};
const ASSISTANT_CAPABILITIES: DestinationCapabilities = {
  browser: true, explorer: false, notes: false, recipes: false, terminalLaunch: false, isolatedAgent: false,
  git: false, layout: false, sessionHistory: false, usage: false,
};
export function resolveDestinationCapabilities(destination: ActiveDestination): DestinationCapabilities {
  if (destination.kind === 'workspace') return WORKSPACE_CAPABILITIES;
  if (destination.kind === 'assistant') return ASSISTANT_CAPABILITIES;
  return { browser: false, explorer: false, notes: false, recipes: false, terminalLaunch: false, isolatedAgent: false,
    git: false, layout: false, sessionHistory: false, usage: false };
}

/** The single Browser owner allowed to show native views: the active Assistant's scope, else the active workspace. */
export function resolveActiveBrowserOwner(destination: ActiveDestination): string | null {
  if (destination.kind === 'assistant') return assistantBrowserOwnerId(destination.assistantId);
  if (destination.kind === 'workspace') return destination.workspaceId;
  return null;
}

export function useActiveDestination(): ActiveDestination {
  const assistantId = useAssistantNavStore((state) => state.activeAssistantId);
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  if (assistantId) return { kind: 'assistant', assistantId };
  if (workspaceId) return { kind: 'workspace', workspaceId };
  return { kind: 'none' };
}

/** Stable identity for effects/memo: an Assistant owner or workspace id string, or null. */
export function useActiveBrowserOwner(): string | null {
  const destination = useActiveDestination();
  return resolveActiveBrowserOwner(destination);
}
