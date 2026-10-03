import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { useKeepInViewport, VIEWPORT_MARGIN } from '../../../src/renderer/lib/useKeepInViewport';

/** Places the menu at [left, left + width] before any translate is applied. */
function stubMenuRect(left: number, width: number) {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { left, right: left + width, top: 0, bottom: 100, width, height: 100, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
  });
}

function Harness({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useKeepInViewport(ref, '.menu', open);
  return <div ref={ref}>{open && <div className="menu" data-testid="menu" />}</div>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('useKeepInViewport', () => {
  it('shifts a menu that would overflow the right edge back inside the window', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    stubMenuRect(600, 400);
    const { getByTestId } = render(<Harness open />);
    expect(getByTestId('menu').style.translate).toBe(`${800 - VIEWPORT_MARGIN - 1000}px 0`);
  });

  it('shifts a menu that would overflow the left edge to the right', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    stubMenuRect(-60, 400);
    const { getByTestId } = render(<Harness open />);
    expect(getByTestId('menu').style.translate).toBe(`${VIEWPORT_MARGIN + 60}px 0`);
  });

  it('leaves a menu that already fits untouched and re-clamps on resize', () => {
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
    stubMenuRect(300, 400);
    const { getByTestId } = render(<Harness open />);
    expect(getByTestId('menu').style.translate).toBe('');
    width.mockReturnValue(600);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(getByTestId('menu').style.translate).toBe(`${600 - VIEWPORT_MARGIN - 700}px 0`);
  });
});
