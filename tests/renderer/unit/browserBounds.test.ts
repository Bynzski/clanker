import { describe, expect, it } from 'vitest';
import { browserBoundsFromDomRect } from '../../../src/renderer/components/useBrowserBoundsLifecycle';

describe('browserBoundsFromDomRect', () => {
  const rect = { left: 10.4, top: 20.4, width: 300.2, height: 180.2 };

  it('keeps CSS coordinates unchanged at default renderer zoom', () => {
    expect(browserBoundsFromDomRect(rect, 0, 0, 1)).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 180,
    });
  });

  it('converts zoomed CSS pixels back to window DIPs', () => {
    expect(browserBoundsFromDomRect(rect, 2, 3, 1.25)).toEqual({
      x: 16,
      y: 29,
      width: 375,
      height: 225,
    });
  });

  it('falls back safely when the reported zoom factor is invalid', () => {
    expect(browserBoundsFromDomRect(rect, 0, 0, Number.NaN)).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 180,
    });
  });
});
