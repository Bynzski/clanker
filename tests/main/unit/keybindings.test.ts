import { describe, expect, it } from 'vitest';
import {
  KEYBINDING_COMMANDS,
  KEYBINDING_COMMAND_IDS,
  contextsOverlap,
  findConflicts,
  formatKeystroke,
  getDefaultBinding,
  getEffectiveBinding,
  getKeybindingCommand,
  isOverridden,
  keystrokeFromDomEvent,
  keystrokeFromElectronInput,
  keystrokesEqual,
  platformFromString,
  resetBinding,
  resolveCommand,
  sanitizeKeybindingOverrides,
  setBinding,
  type Keystroke,
} from '../../../src/shared/keybindings';

const ks = (code: string, mods: Partial<Omit<Keystroke, 'code'>> = {}): Keystroke => ({
  code, primary: false, ctrl: false, shift: false, alt: false, ...mods,
});

const dom = (code: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods,
});

describe('normalization', () => {
  it('maps DOM Ctrl and Meta to the primary modifier off macOS', () => {
    expect(keystrokeFromDomEvent(dom('KeyS', { ctrlKey: true }), 'other')).toEqual(ks('KeyS', { primary: true }));
    expect(keystrokeFromDomEvent(dom('KeyS', { metaKey: true }), 'other')).toEqual(ks('KeyS', { primary: true }));
  });

  it('maps only Meta to primary on macOS and keeps literal Control separate', () => {
    expect(keystrokeFromDomEvent(dom('KeyS', { metaKey: true }), 'mac')).toEqual(ks('KeyS', { primary: true }));
    expect(keystrokeFromDomEvent(dom('Tab', { ctrlKey: true }), 'mac')).toEqual(ks('Tab', { ctrl: true }));
  });

  it('captures Shift and Alt', () => {
    expect(keystrokeFromDomEvent(dom('KeyF', { ctrlKey: true, shiftKey: true, altKey: true }), 'other'))
      .toEqual(ks('KeyF', { primary: true, shift: true, alt: true }));
  });

  it('rejects modifier-only and code-less events', () => {
    expect(keystrokeFromDomEvent(dom('ControlLeft', { ctrlKey: true }), 'other')).toBeNull();
    expect(keystrokeFromDomEvent(dom('ShiftRight', { shiftKey: true }), 'other')).toBeNull();
    expect(keystrokeFromDomEvent(dom('MetaLeft', { metaKey: true }), 'mac')).toBeNull();
    expect(keystrokeFromDomEvent(dom(''), 'other')).toBeNull();
    expect(keystrokeFromDomEvent(dom('Unidentified key!'), 'other')).toBeNull();
  });

  it('normalizes Electron input identically to DOM events', () => {
    const input = { code: 'KeyL', control: true, meta: false, shift: false, alt: false };
    expect(keystrokeFromElectronInput(input, 'other')).toEqual(keystrokeFromDomEvent(dom('KeyL', { ctrlKey: true }), 'other'));
    expect(keystrokeFromElectronInput({ ...input, control: false, meta: true }, 'mac'))
      .toEqual(ks('KeyL', { primary: true }));
    expect(keystrokeFromElectronInput({ control: true, meta: false, shift: false, alt: false }, 'other')).toBeNull();
  });

  it('detects platform strings', () => {
    expect(platformFromString('darwin')).toBe('mac');
    expect(platformFromString('MacIntel')).toBe('mac');
    expect(platformFromString('linux')).toBe('other');
    expect(platformFromString('win32')).toBe('other');
    expect(platformFromString(undefined)).toBe('other');
  });
});

describe('display formatting', () => {
  it('formats per platform', () => {
    const binding = ks('KeyP', { primary: true, shift: true });
    expect(formatKeystroke(binding, 'other')).toBe('Ctrl+Shift+P');
    expect(formatKeystroke(binding, 'mac')).toBe('Cmd+Shift+P');
    expect(formatKeystroke(ks('KeyF', { primary: true, alt: true }), 'mac')).toBe('Cmd+Option+F');
    expect(formatKeystroke(ks('KeyF', { primary: true, alt: true }), 'other')).toBe('Ctrl+Alt+F');
  });

  it('formats keys readably', () => {
    expect(formatKeystroke(ks('Comma', { primary: true }), 'other')).toBe('Ctrl+,');
    expect(formatKeystroke(ks('Equal', { primary: true }), 'other')).toBe('Ctrl+=');
    expect(formatKeystroke(ks('Digit0', { primary: true }), 'other')).toBe('Ctrl+0');
    expect(formatKeystroke(ks('Tab', { ctrl: true }), 'mac')).toBe('Ctrl+Tab');
    expect(formatKeystroke(ks('F12'), 'other')).toBe('F12');
  });
});

describe('registry', () => {
  it('has unique stable ids matching the id list', () => {
    expect(KEYBINDING_COMMANDS.map((c) => c.id)).toEqual([...KEYBINDING_COMMAND_IDS]);
    expect(new Set(KEYBINDING_COMMAND_IDS).size).toBe(KEYBINDING_COMMAND_IDS.length);
  });

  it('declares the first-pass defaults', () => {
    const binding = (id: Parameters<typeof getKeybindingCommand>[0]) => getKeybindingCommand(id).defaultBinding;
    expect(binding('editor.save')).toEqual(ks('KeyS', { primary: true }));
    expect(binding('layout.fitAll')).toEqual(ks('KeyF', { primary: true, alt: true }));
    expect(binding('app.openSettings')).toEqual(ks('Comma', { primary: true }));
    expect(binding('view.toggleExplorer')).toEqual(ks('KeyB', { primary: true }));
    expect(binding('zoom.in')).toEqual(ks('Equal', { primary: true }));
    expect(binding('browser.nextTab')).toEqual(ks('Tab', { primary: true }));
  });

  it('keeps Save editor-only and tab commands browser-only', () => {
    expect(getKeybindingCommand('editor.save').contexts).toEqual(['editor']);
    expect(getKeybindingCommand('browser.newTab').contexts).toEqual(['browser']);
    expect(getKeybindingCommand('view.toggleExplorer').contexts).not.toContain('terminal');
    expect(getKeybindingCommand('view.toggleExplorer').contexts).not.toContain('browser');
  });

  it('uses Control for tab cycling on macOS', () => {
    const next = getKeybindingCommand('browser.nextTab');
    expect(getDefaultBinding(next, 'mac')).toEqual(ks('Tab', { ctrl: true }));
    expect(getDefaultBinding(next, 'other')).toEqual(ks('Tab', { primary: true }));
  });

  it('has no overlapping-context default conflicts', () => {
    for (const platform of ['mac', 'other'] as const) {
      for (const command of KEYBINDING_COMMANDS) {
        expect(findConflicts(command.id, getDefaultBinding(command, platform), {}, platform)).toEqual([]);
      }
    }
  });
});

describe('effective bindings and resolution', () => {
  it('uses defaults without overrides', () => {
    expect(getEffectiveBinding('editor.save', {}, 'other')).toEqual(ks('KeyS', { primary: true }));
    expect(isOverridden('editor.save', {})).toBe(false);
  });

  it('prefers an override and treats null as explicitly unbound', () => {
    const custom = ks('KeyS', { primary: true, shift: true });
    expect(getEffectiveBinding('editor.save', { 'editor.save': custom }, 'other')).toEqual(custom);
    expect(getEffectiveBinding('editor.save', { 'editor.save': null }, 'other')).toBeNull();
    expect(isOverridden('editor.save', { 'editor.save': null })).toBe(true);
  });

  it('resolves commands only in their contexts', () => {
    const save = ks('KeyS', { primary: true });
    expect(resolveCommand(save, 'editor', {}, 'other')).toBe('editor.save');
    expect(resolveCommand(save, 'terminal', {}, 'other')).toBeNull();
    expect(resolveCommand(save, 'app', {}, 'other')).toBeNull();
    expect(resolveCommand(save, 'browser', {}, 'other')).toBeNull();
  });

  it('allows the same zoom keys in every surface', () => {
    const zoomIn = ks('Equal', { primary: true });
    for (const context of ['app', 'editor', 'terminal', 'browser'] as const) {
      expect(resolveCommand(zoomIn, context, {}, 'other')).toBe('zoom.in');
    }
  });

  it('keeps Ctrl+Shift+= as a zoom alias only while zoom.in is not overridden', () => {
    const alias = ks('Equal', { primary: true, shift: true });
    expect(resolveCommand(alias, 'app', {}, 'other')).toBe('zoom.in');
    expect(resolveCommand(alias, 'app', { 'zoom.in': ks('KeyJ', { primary: true }) }, 'other')).toBeNull();
  });

  it('no longer maps the old Ctrl+Shift+F to Fit All', () => {
    const old = ks('KeyF', { primary: true, shift: true });
    for (const context of ['app', 'editor', 'terminal', 'browser'] as const) {
      expect(resolveCommand(old, context, {}, 'other')).toBeNull();
    }
    expect(resolveCommand(ks('KeyF', { primary: true, alt: true }), 'app', {}, 'other')).toBe('layout.fitAll');
  });

  it('does not resolve an unbound command', () => {
    expect(resolveCommand(ks('KeyS', { primary: true }), 'editor', { 'editor.save': null }, 'other')).toBeNull();
  });

  it('resolves overridden bindings and drops the default key', () => {
    const overrides = { 'editor.save': ks('KeyK', { primary: true }) };
    expect(resolveCommand(ks('KeyK', { primary: true }), 'editor', overrides, 'other')).toBe('editor.save');
    expect(resolveCommand(ks('KeyS', { primary: true }), 'editor', overrides, 'other')).toBeNull();
  });
});

describe('context overlap and conflicts', () => {
  it('detects overlap', () => {
    expect(contextsOverlap(['app', 'editor'], ['editor'])).toBe(true);
    expect(contextsOverlap(['browser'], ['app', 'editor'])).toBe(false);
  });

  it('reports a conflict for the same key in overlapping contexts', () => {
    // Explorer (app, editor) vs Save (editor)
    expect(findConflicts('view.toggleExplorer', ks('KeyS', { primary: true }), {}, 'other')).toEqual(['editor.save']);
  });

  it('allows the same key in disjoint contexts', () => {
    // Save (editor) vs browser refresh (browser)
    expect(findConflicts('editor.save', ks('KeyR', { primary: true }), {}, 'other')).toEqual([]);
    expect(findConflicts('browser.refresh', ks('KeyB', { primary: true }), {}, 'other')).toEqual([]);
  });

  it('does not report the command itself', () => {
    expect(findConflicts('editor.save', ks('KeyS', { primary: true }), {}, 'other')).toEqual([]);
  });

  it('accounts for overrides when finding conflicts', () => {
    const overrides = { 'editor.save': ks('KeyQ', { primary: true }) };
    expect(findConflicts('view.toggleExplorer', ks('KeyS', { primary: true }), overrides, 'other')).toEqual([]);
    expect(findConflicts('view.toggleExplorer', ks('KeyQ', { primary: true }), overrides, 'other')).toEqual(['editor.save']);
  });

  it('ignores unbound commands', () => {
    expect(findConflicts('view.toggleExplorer', ks('KeyS', { primary: true }), { 'editor.save': null }, 'other')).toEqual([]);
  });
});

describe('setBinding / resetBinding', () => {
  it('stores only deviations from the default', () => {
    const custom = ks('KeyK', { primary: true });
    const changed = setBinding({}, 'editor.save', custom, 'other');
    expect(changed).toEqual({ 'editor.save': custom });
    expect(setBinding(changed, 'editor.save', ks('KeyS', { primary: true }), 'other')).toEqual({});
  });

  it('can explicitly unbind', () => {
    expect(setBinding({}, 'editor.save', null, 'other')).toEqual({ 'editor.save': null });
  });

  it('resetBinding deletes one override and leaves others', () => {
    const overrides = { 'editor.save': null, 'zoom.in': ks('KeyJ', { primary: true }) };
    expect(resetBinding(overrides, 'editor.save')).toEqual({ 'zoom.in': ks('KeyJ', { primary: true }) });
    expect(getEffectiveBinding('editor.save', resetBinding(overrides, 'editor.save'), 'other'))
      .toEqual(ks('KeyS', { primary: true }));
  });

  it('replace unbinds the conflicting command so its default cannot return', () => {
    const save = ks('KeyS', { primary: true });
    const conflicts = findConflicts('view.toggleExplorer', save, {}, 'other');
    const next = setBinding({}, 'view.toggleExplorer', save, 'other', conflicts);
    expect(next['editor.save']).toBeNull();
    expect(getEffectiveBinding('editor.save', next, 'other')).toBeNull();
    expect(getEffectiveBinding('view.toggleExplorer', next, 'other')).toEqual(save);
    expect(resolveCommand(save, 'editor', next, 'other')).toBe('view.toggleExplorer');
    for (const command of KEYBINDING_COMMANDS) {
      const effective = getEffectiveBinding(command.id, next, 'other');
      if (effective) expect(findConflicts(command.id, effective, next, 'other')).toEqual([]);
    }
  });

  it('replacing a conflict with a keystroke equal to the replaced command default stays unambiguous', () => {
    // Move Save onto Explorer's default key.
    const explorerKey = ks('KeyB', { primary: true });
    const next = setBinding({}, 'editor.save', explorerKey, 'other', findConflicts('editor.save', explorerKey, {}, 'other'));
    expect(next['view.toggleExplorer']).toBeNull();
    expect(resolveCommand(explorerKey, 'editor', next, 'other')).toBe('editor.save');
    expect(resolveCommand(explorerKey, 'app', next, 'other')).toBeNull();
  });

  it('Reset All is an empty override map', () => {
    expect(getEffectiveBinding('editor.save', {}, 'other')).toEqual(ks('KeyS', { primary: true }));
  });
});

describe('sanitizeKeybindingOverrides', () => {
  it('keeps valid keystrokes and explicit null', () => {
    const valid = ks('KeyK', { primary: true });
    expect(sanitizeKeybindingOverrides({ 'editor.save': valid, 'zoom.in': null }))
      .toEqual({ 'editor.save': valid, 'zoom.in': null });
  });

  it('drops unknown command ids', () => {
    expect(sanitizeKeybindingOverrides({ 'rm.rf': ks('KeyK'), __proto__: { 'editor.save': null } })).toEqual({});
  });

  it('drops malformed keystrokes', () => {
    expect(sanitizeKeybindingOverrides({
      'editor.save': { code: 'KeyK' },
      'zoom.in': { code: 'KeyK', primary: 'yes', ctrl: false, shift: false, alt: false },
      'zoom.out': { code: 'ControlLeft', primary: true, ctrl: false, shift: false, alt: false },
      'zoom.reset': { code: 'x'.repeat(100), primary: true, ctrl: false, shift: false, alt: false },
      'layout.fitAll': 'Ctrl+F',
      'app.openSettings': undefined,
    })).toEqual({});
  });

  it('strips extra fields', () => {
    const result = sanitizeKeybindingOverrides({
      'editor.save': { code: 'KeyK', primary: true, ctrl: false, shift: false, alt: false, run: 'evil' },
    });
    expect(result['editor.save']).toEqual(ks('KeyK', { primary: true }));
  });

  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 5, 'x', [], [1]]) expect(sanitizeKeybindingOverrides(bad)).toEqual({});
  });

  it('keystrokesEqual compares every field', () => {
    expect(keystrokesEqual(ks('KeyA'), ks('KeyA'))).toBe(true);
    expect(keystrokesEqual(ks('KeyA'), ks('KeyA', { shift: true }))).toBe(false);
    expect(keystrokesEqual(ks('KeyA'), ks('KeyB'))).toBe(false);
  });
});
