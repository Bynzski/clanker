// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarFilesDivider from '../../../src/renderer/components/SidebarFilesDivider';

afterEach(cleanup);

function setup() {
  const onChange = vi.fn();
  const view = render(<div><SidebarFilesDivider percent={50} onChange={onChange} /></div>);
  const divider = screen.getByRole('separator', { name: 'Resize Files section' });
  vi.spyOn(divider.parentElement!, 'getBoundingClientRect').mockReturnValue({ height: 800 } as DOMRect);
  return { ...view, divider, onChange };
}

describe('Files height divider', () => {
  it('grows upward, shrinks downward, and clamps both sections', () => {
    const { divider, onChange } = setup();
    fireEvent.mouseDown(divider, { clientY: 400 });
    fireEvent.mouseMove(document, { clientY: 200 });
    expect(onChange).toHaveBeenLastCalledWith(75);
    fireEvent.mouseMove(document, { clientY: 600 });
    expect(onChange).toHaveBeenLastCalledWith(25);
    fireEvent.mouseMove(document, { clientY: -1000 });
    expect(onChange).toHaveBeenLastCalledWith(85);
    fireEvent.mouseMove(document, { clientY: 2000 });
    expect(onChange).toHaveBeenLastCalledWith(15);
    fireEvent.mouseUp(document);
    onChange.mockClear();
    fireEvent.mouseMove(document, { clientY: 400 });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
  });

  it.each(['blur', 'unmount'])('cleans up an interrupted drag on %s', (reason) => {
    const { divider, onChange, unmount } = setup();
    document.body.style.userSelect = 'text';
    fireEvent.mouseDown(divider, { clientY: 400 });
    expect(document.body.style.cursor).toBe('row-resize');
    if (reason === 'blur') fireEvent.blur(window);
    else unmount();
    fireEvent.mouseMove(document, { clientY: 200 });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('text');
    document.body.style.userSelect = '';
  });

  it('supports arrow keys and Home/End without intercepting other keys', () => {
    const { divider, onChange } = setup();
    for (const [key, value] of [['ArrowUp', 55], ['ArrowDown', 45], ['Home', 85], ['End', 15]] as const) {
      fireEvent.keyDown(divider, { key });
      expect(onChange).toHaveBeenLastCalledWith(value);
    }
    onChange.mockClear();
    fireEvent.keyDown(divider, { key: 'Tab' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
