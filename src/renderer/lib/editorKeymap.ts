import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { keymap, type KeyBinding } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/**
 * CodeMirror's own editing, navigation, undo and redo keys. These are editor
 * behavior, not Clanker commands: they are not configurable and not listed in
 * the Keyboard Shortcuts dialog. Clanker commands such as Save go through the
 * app keybinding system instead.
 */
export const EDITOR_BASELINE_BINDINGS: readonly KeyBinding[] = [...defaultKeymap, ...historyKeymap];

export function getEditorBaselineExtensions(): Extension[] {
  return [history(), keymap.of([...EDITOR_BASELINE_BINDINGS])];
}
