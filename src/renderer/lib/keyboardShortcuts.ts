import {
  keystrokeFromDomEvent,
  resolveCommand,
  type DomKeyLike,
  type KeybindingCommandId,
  type KeybindingContext,
} from '../../shared/keybindings';
import { KEYBINDING_PLATFORM, useKeybindingStore } from '../store/keybindingStore';

/**
 * The one renderer-side adapter from a DOM/xterm keyboard event to a Clanker
 * command, using the shared keystroke model and the current effective bindings.
 * Surfaces call this with their own context and decide whether to consume.
 */
export function resolveKeyboardCommand(event: DomKeyLike, context: KeybindingContext): KeybindingCommandId | null {
  const keystroke = keystrokeFromDomEvent(event, KEYBINDING_PLATFORM);
  if (!keystroke) return null;
  return resolveCommand(keystroke, context, useKeybindingStore.getState().overrides, KEYBINDING_PLATFORM);
}

export type ZoomShortcutAction = 'in' | 'out' | 'reset';

const ZOOM_COMMAND_ACTIONS: Partial<Record<KeybindingCommandId, ZoomShortcutAction>> = {
  'zoom.in': 'in',
  'zoom.out': 'out',
  'zoom.reset': 'reset',
};

export function getZoomActionForCommand(command: KeybindingCommandId | null): ZoomShortcutAction | null {
  return command ? ZOOM_COMMAND_ACTIONS[command] ?? null : null;
}

export type WheelZoomAction = 'in' | 'out';

/**
 * Ctrl+wheel zoom direction; ordinary wheel scrolling and zero deltas are not zoom.
 * Wheel zoom is not part of the configurable keybinding system.
 */
export function getWheelZoomAction(event: { ctrlKey: boolean; deltaY: number }): WheelZoomAction | null {
  if (!event.ctrlKey || event.deltaY === 0) {
    return null;
  }
  return event.deltaY < 0 ? 'in' : 'out';
}
