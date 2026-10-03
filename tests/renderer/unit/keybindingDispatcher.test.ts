// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchAppKeybinding,
  getEventContext,
  openSettings,
  registerOpenSettingsHandler,
  type AppCommandActions,
} from '../../../src/renderer/lib/keybindingDispatcher';
import { getZoomActionForCommand, resolveKeyboardCommand } from '../../../src/renderer/lib/keyboardShortcuts';
import { useKeybindingStore } from '../../../src/renderer/store/keybindingStore';

const makeActions = (): AppCommandActions => ({
  openSettings: vi.fn(),
  fitAllPanes: vi.fn(),
  toggleExplorer: vi.fn(),
  saveActiveEditorFile: vi.fn(),
  zoomApp: vi.fn(),
});

function press(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function surface(context?: string) {
  const root = document.createElement('div');
  if (context) root.setAttribute('data-keybinding-context', context);
  const inner = document.createElement('input');
  root.appendChild(inner);
  document.body.appendChild(root);
  return inner;
}

describe('keybinding dispatcher', () => {
  beforeEach(() => {
    useKeybindingStore.setState({ overrides: {}, capturing: false });
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('resolveKeyboardCommand', () => {
    it('resolves with the current effective bindings', () => {
      const event = new KeyboardEvent('keydown', { code: 'KeyS', ctrlKey: true });
      expect(resolveKeyboardCommand(event, 'editor')).toBe('editor.save');
      expect(resolveKeyboardCommand(event, 'app')).toBeNull();
      expect(resolveKeyboardCommand(event, 'terminal')).toBeNull();
      useKeybindingStore.setState({ overrides: { 'editor.save': null } });
      expect(resolveKeyboardCommand(event, 'editor')).toBeNull();
    });

    it('ignores modifier-only presses', () => {
      expect(resolveKeyboardCommand(new KeyboardEvent('keydown', { code: 'ControlLeft', ctrlKey: true }), 'app')).toBeNull();
    });

    it('resolves numpad zoom aliases and drops them after a rebind', () => {
      const add = new KeyboardEvent('keydown', { code: 'NumpadAdd', ctrlKey: true });
      expect(resolveKeyboardCommand(add, 'app')).toBe('zoom.in');
      expect(resolveKeyboardCommand(new KeyboardEvent('keydown', { code: 'Numpad0', metaKey: true }), 'terminal')).toBe('zoom.reset');
      useKeybindingStore.setState({ overrides: { 'zoom.in': null } });
      expect(resolveKeyboardCommand(add, 'app')).toBeNull();
    });

    it('maps zoom commands to zoom actions only', () => {
      expect(getZoomActionForCommand('zoom.in')).toBe('in');
      expect(getZoomActionForCommand('zoom.out')).toBe('out');
      expect(getZoomActionForCommand('zoom.reset')).toBe('reset');
      expect(getZoomActionForCommand('editor.save')).toBeNull();
      expect(getZoomActionForCommand(null)).toBeNull();
    });
  });

  describe('getEventContext', () => {
    it('reads the nearest marked surface', () => {
      expect(getEventContext(surface('terminal'))).toBe('terminal');
      expect(getEventContext(surface('editor'))).toBe('editor');
      expect(getEventContext(surface())).toBe('app');
      expect(getEventContext(null)).toBe('app');
      expect(getEventContext(surface('browser'))).toBe('app'); // browser input never reaches the renderer DOM
    });
  });

  describe('dispatchAppKeybinding', () => {
    it('runs app-context commands and consumes them', () => {
      const actions = makeActions();
      const event = press(surface(), { code: 'KeyB', ctrlKey: true });
      expect(dispatchAppKeybinding(event, actions)).toBe(true);
      expect(actions.toggleExplorer).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('runs Settings and Fit All from app chrome and the editor', () => {
      const actions = makeActions();
      for (const field of [surface(), surface('editor')]) {
        dispatchAppKeybinding(press(field, { code: 'Comma', metaKey: true }), actions);
        dispatchAppKeybinding(press(field, { code: 'KeyF', ctrlKey: true, altKey: true }), actions);
      }
      expect(actions.openSettings).toHaveBeenCalledTimes(2);
      expect(actions.fitAllPanes).toHaveBeenCalledTimes(2);
    });

    it('saves only from the editor surface', () => {
      const actions = makeActions();
      const keys = { code: 'KeyS', ctrlKey: true };
      expect(dispatchAppKeybinding(press(surface('editor'), keys), actions)).toBe(true);
      expect(dispatchAppKeybinding(press(surface(), keys), actions)).toBe(false);
      const terminalEvent = press(surface('terminal'), keys);
      expect(dispatchAppKeybinding(terminalEvent, actions)).toBe(false);
      expect(terminalEvent.defaultPrevented).toBe(false);
      expect(actions.saveActiveEditorFile).toHaveBeenCalledTimes(1);
    });

    it('never handles anything from a terminal, so the PTY keeps every key', () => {
      const actions = makeActions();
      const field = surface('terminal');
      for (const init of [
        { code: 'KeyB', ctrlKey: true }, { code: 'KeyS', ctrlKey: true }, { code: 'KeyT', ctrlKey: true },
        { code: 'KeyW', ctrlKey: true }, { code: 'Comma', ctrlKey: true }, { code: 'Equal', ctrlKey: true },
        { code: 'KeyF', ctrlKey: true, altKey: true },
      ]) {
        const event = press(field, init);
        expect(dispatchAppKeybinding(event, actions)).toBe(false);
        expect(event.defaultPrevented).toBe(false);
      }
      for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
    });

    it('never executes browser-context commands from the renderer', () => {
      const actions = makeActions();
      for (const code of ['KeyL', 'KeyT', 'KeyW', 'KeyR', 'Tab']) {
        const event = press(surface(), { code, ctrlKey: true });
        expect(dispatchAppKeybinding(event, actions)).toBe(false);
        expect(event.defaultPrevented).toBe(false);
      }
    });

    it('routes zoom from app chrome and the editor to the app', () => {
      const actions = makeActions();
      dispatchAppKeybinding(press(surface(), { code: 'Equal', ctrlKey: true }), actions);
      dispatchAppKeybinding(press(surface('editor'), { code: 'Minus', metaKey: true }), actions);
      dispatchAppKeybinding(press(surface(), { code: 'Digit0', ctrlKey: true }), actions);
      expect(actions.zoomApp).toHaveBeenNthCalledWith(1, 'in');
      expect(actions.zoomApp).toHaveBeenNthCalledWith(2, 'out');
      expect(actions.zoomApp).toHaveBeenNthCalledWith(3, 'reset');
    });

    it('skips events a surface already handled', () => {
      const actions = makeActions();
      const field = surface('editor');
      field.addEventListener('keydown', (event) => event.preventDefault());
      expect(dispatchAppKeybinding(press(field, { code: 'KeyS', ctrlKey: true }), actions)).toBe(false);
      expect(actions.saveActiveEditorFile).not.toHaveBeenCalled();
    });

    it('does nothing while a shortcut is being captured', () => {
      const actions = makeActions();
      useKeybindingStore.setState({ capturing: true });
      expect(dispatchAppKeybinding(press(surface(), { code: 'KeyB', ctrlKey: true }), actions)).toBe(false);
      expect(dispatchAppKeybinding(press(surface(), { code: 'Equal', ctrlKey: true }), actions)).toBe(false);
      for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
    });

    it('keeps modal dialogs local except for zoom', () => {
      const actions = makeActions();
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      const field = document.createElement('input');
      dialog.appendChild(field);
      document.body.appendChild(dialog);
      expect(dispatchAppKeybinding(press(field, { code: 'Comma', ctrlKey: true }), actions)).toBe(false);
      expect(dispatchAppKeybinding(press(field, { code: 'KeyB', ctrlKey: true }), actions)).toBe(false);
      expect(dispatchAppKeybinding(press(field, { code: 'Equal', ctrlKey: true }), actions)).toBe(true);
      expect(actions.openSettings).not.toHaveBeenCalled();
      expect(actions.zoomApp).toHaveBeenCalledWith('in');
    });

    it('applies overrides: rebound keys work and defaults are released', () => {
      const actions = makeActions();
      useKeybindingStore.setState({
        overrides: { 'view.toggleExplorer': { code: 'KeyE', primary: true, ctrl: false, shift: false, alt: false } },
      });
      expect(dispatchAppKeybinding(press(surface(), { code: 'KeyE', ctrlKey: true }), actions)).toBe(true);
      expect(dispatchAppKeybinding(press(surface(), { code: 'KeyB', ctrlKey: true }), actions)).toBe(false);
      expect(actions.toggleExplorer).toHaveBeenCalledTimes(1);
    });

    it('does not run explicitly unbound commands', () => {
      const actions = makeActions();
      useKeybindingStore.setState({ overrides: { 'view.toggleExplorer': null } });
      expect(dispatchAppKeybinding(press(surface(), { code: 'KeyB', ctrlKey: true }), actions)).toBe(false);
    });
  });

  describe('Settings opener registration', () => {
    it('invokes the registered handler and stops after disposal', () => {
      const handler = vi.fn();
      const dispose = registerOpenSettingsHandler(handler);
      openSettings();
      expect(handler).toHaveBeenCalledTimes(1);
      dispose();
      openSettings();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not let a stale disposer remove a newer handler', () => {
      const first = vi.fn();
      const second = vi.fn();
      const disposeFirst = registerOpenSettingsHandler(first);
      const disposeSecond = registerOpenSettingsHandler(second);
      disposeFirst();
      openSettings();
      expect(second).toHaveBeenCalledTimes(1);
      disposeSecond();
    });
  });
});
