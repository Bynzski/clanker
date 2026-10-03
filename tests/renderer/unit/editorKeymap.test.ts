import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EDITOR_BASELINE_BINDINGS, getEditorBaselineExtensions } from '../../../src/renderer/lib/editorKeymap';
import { KEYBINDING_COMMANDS } from '../../../src/shared/keybindings';

describe('editor keymap baseline', () => {
  it('provides undo/redo and navigation/editing keys', () => {
    const keys = EDITOR_BASELINE_BINDINGS.flatMap((binding) => [binding.key, binding.mac, binding.win, binding.linux]);
    expect(keys).toEqual(expect.arrayContaining(['Mod-z', 'Mod-y', 'Mod-Shift-z', 'Home', 'End', 'Backspace', 'Enter', 'Mod-a']));
  });

  it('builds into a real editor state with history enabled', () => {
    const state = EditorState.create({ doc: 'hello', extensions: getEditorBaselineExtensions() });
    expect(state.doc.toString()).toBe('hello');
  });

  it('does not shadow Clanker editor-context shortcuts', () => {
    // CodeMirror key names for the default Clanker bindings that are valid in the editor context.
    const names = KEYBINDING_COMMANDS.filter((command) => command.contexts.includes('editor')).map((command) => {
      const { code, shift, alt } = command.defaultBinding;
      const base = code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Comma' ? ',' : code === 'Equal' ? '=' : code === 'Minus' ? '-' : code.replace('Digit', '');
      return ['Mod', alt && 'Alt', shift && 'Shift', base].filter(Boolean).join('-');
    });
    const used = new Set(EDITOR_BASELINE_BINDINGS.flatMap((binding) => [binding.key, binding.mac, binding.win, binding.linux]).filter(Boolean));
    for (const name of names) expect(used.has(name), `${name} is consumed by CodeMirror`).toBe(false);
  });
});
