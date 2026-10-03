import { describe, expect, it } from 'vitest';
import { getWheelZoomAction } from '../../../src/renderer/lib/keyboardShortcuts';

describe('getWheelZoomAction', () => {
  it('zooms in on Ctrl+wheel up', () => {
    expect(getWheelZoomAction({ ctrlKey: true, deltaY: -100 })).toBe('in');
  });

  it('zooms out on Ctrl+wheel down', () => {
    expect(getWheelZoomAction({ ctrlKey: true, deltaY: 100 })).toBe('out');
  });

  it('ignores ordinary wheel events', () => {
    expect(getWheelZoomAction({ ctrlKey: false, deltaY: -100 })).toBeNull();
    expect(getWheelZoomAction({ ctrlKey: false, deltaY: 100 })).toBeNull();
  });

  it('ignores zero vertical delta', () => {
    expect(getWheelZoomAction({ ctrlKey: true, deltaY: 0 })).toBeNull();
  });
});
