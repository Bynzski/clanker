import type { KeybindingCommandId, KeybindingContext } from '../../shared/keybindings';
import { executeWorkspacePageCommand } from './workspacePageCommands';
import { useKeybindingStore } from '../store/keybindingStore';
import { getZoomActionForCommand, resolveKeyboardCommand, type ZoomShortcutAction } from './keyboardShortcuts';

/** Actions the application owns; the dispatcher only maps commands onto them. */
export interface AppCommandActions {
  openSettings: () => void;
  fitAllPanes: () => void;
  toggleExplorer: () => void;
  saveActiveEditorFile: () => void;
  zoomApp: (action: ZoomShortcutAction) => void;
}

let openSettingsHandler: (() => void) | null = null;

/** The stable application Settings owner registers here; entry points share one destination. */
export function registerOpenSettingsHandler(handler: () => void): () => void {
  openSettingsHandler = handler;
  return () => {
    if (openSettingsHandler === handler) openSettingsHandler = null;
  };
}

export function openSettings(): void {
  openSettingsHandler?.();
}

/**
 * Renderer context of a keyboard event, from the nearest marked surface.
 * Surfaces mark themselves with `data-keybinding-context`; anything else is app chrome.
 */
export function getEventContext(target: EventTarget | null): KeybindingContext {
  const marked = target instanceof Element ? target.closest('[data-keybinding-context]') : null;
  const value = marked?.getAttribute('data-keybinding-context');
  return value === 'terminal' || value === 'editor' ? value : 'app';
}

function isInsideModalDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]') !== null;
}

function runCommand(command: KeybindingCommandId, actions: AppCommandActions): boolean {
  const zoom = getZoomActionForCommand(command);
  if (zoom) {
    actions.zoomApp(zoom);
    return true;
  }
  switch (command) {
    case 'app.openSettings': actions.openSettings(); return true;
    case 'layout.fitAll': actions.fitAllPanes(); return true;
    case 'view.toggleExplorer': actions.toggleExplorer(); return true;
    case 'editor.save': actions.saveActiveEditorFile(); return true;
    default:
      // Browser commands are executed only through browser ownership (main).
      return false;
  }
}

/**
 * Handle a window-level keydown for app/editor-context commands.
 * Returns true when the event was consumed. Terminal-owned events are never
 * handled here (xterm decides what it consumes and the rest reaches the PTY),
 * and browser commands never run from the renderer.
 */
export function dispatchAppKeybinding(event: KeyboardEvent, actions: AppCommandActions): boolean {
  if (event.defaultPrevented || useKeybindingStore.getState().capturing) return false;

  const context = getEventContext(event.target);
  if (context === 'terminal') return false;

  const command = resolveKeyboardCommand(event, context);
  if (!command) return false;
  // Modal dialogs keep ordinary input semantics; only zoom stays global.
  if (isInsideModalDialog(event.target) && getZoomActionForCommand(command) == null) return false;

  if (!executeWorkspacePageCommand(command) && !runCommand(command, actions)) return false;
  event.preventDefault();
  return true;
}
