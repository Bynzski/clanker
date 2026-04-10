// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { isSaveShortcut } from '../../../src/renderer/lib/keyboardShortcuts';

describe('isSaveShortcut', () => {
  const createEvent = (overrides: Partial<KeyboardEventInit> & { key?: string }): KeyboardEvent => {
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
