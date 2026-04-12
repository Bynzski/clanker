// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { getZoomShortcutAction, isSaveShortcut } from '../../../src/renderer/lib/keyboardShortcuts';

describe('isSaveShortcut', () => {
  const createEvent = (
    overrides: Partial<KeyboardEventInit> & { key?: string; code?: string }
  ): KeyboardEvent => {
    return new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...overrides,
    });
  };

  it('returns true for Ctrl+S', () => {
    const event = createEvent({ key: 's', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(isSaveShortcut(event)).toBe(true);
  });

  it('returns true for Cmd+S (metaKey)', () => {
    const event = createEvent({ key: 's', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false });
    expect(isSaveShortcut(event)).toBe(true);
  });

  it('returns false for Ctrl+Shift+S', () => {
    const event = createEvent({ key: 's', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false });
    expect(isSaveShortcut(event)).toBe(false);
  });

  it('returns false for Alt+S', () => {
    const event = createEvent({ key: 's', ctrlKey: false, metaKey: false, shiftKey: false, altKey: true });
    expect(isSaveShortcut(event)).toBe(false);
  });

  it('returns false for plain S', () => {
    const event = createEvent({ key: 's', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
    expect(isSaveShortcut(event)).toBe(false);
  });

  it('returns false for Ctrl+A', () => {
    const event = createEvent({ key: 'a', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(isSaveShortcut(event)).toBe(false);
  });

  it('handles uppercase S key', () => {
    const event = createEvent({ key: 'S', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(isSaveShortcut(event)).toBe(true);
  });

  it('returns false for Ctrl+Shift+Alt+S', () => {
    const event = createEvent({ key: 's', ctrlKey: true, metaKey: false, shiftKey: true, altKey: true });
    expect(isSaveShortcut(event)).toBe(false);
  });
});

describe('getZoomShortcutAction', () => {
  const createEvent = (
    overrides: Partial<KeyboardEventInit> & { key?: string; code?: string }
  ): KeyboardEvent => {
    return new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...overrides,
    });
  };

  it('returns in for Ctrl+Equal', () => {
    const event = createEvent({ key: '=', code: 'Equal', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(getZoomShortcutAction(event)).toBe('in');
  });

  it('returns in for Meta+Equal', () => {
    const event = createEvent({ key: '=', code: 'Equal', ctrlKey: false, metaKey: true, shiftKey: true, altKey: false });
    expect(getZoomShortcutAction(event)).toBe('in');
  });

  it('returns out for Ctrl+Minus', () => {
    const event = createEvent({ key: '-', code: 'Minus', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(getZoomShortcutAction(event)).toBe('out');
  });

  it('returns reset for Ctrl+Digit0', () => {
    const event = createEvent({ key: '0', code: 'Digit0', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    expect(getZoomShortcutAction(event)).toBe('reset');
  });

  it('does not treat plus as a separate zoom shortcut', () => {
    const event = createEvent({ key: '+', code: 'Equal', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false });
    expect(getZoomShortcutAction(event)).toBe('in');
  });
});
