import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl, SegmentedControlItem } from '../../../src/renderer/components/ui/SegmentedControl';

function Choices({ disabled = false, onValueChange = () => {} }: { disabled?: boolean; onValueChange?: (value: string) => void }) {
  return <SegmentedControl aria-label="Layout" defaultValue="one" disabled={disabled} onValueChange={onValueChange}>
    <SegmentedControlItem value="one">One</SegmentedControlItem>
    <SegmentedControlItem value="two" disabled>Two</SegmentedControlItem>
    <SegmentedControlItem value="four">Four</SegmentedControlItem>
  </SegmentedControl>;
}

describe('SegmentedControl', () => {
  it('exposes a named radio group and one checked item, and selects by mouse', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Choices onValueChange={onValueChange} />);
    expect(screen.getByRole('radiogroup', { name: 'Layout' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'One' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Four' })).not.toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Four' }));
    expect(screen.getByRole('radio', { name: 'Four' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'One' })).not.toBeChecked();
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('four');
  });

  it('tabs to the selection, navigates/selects with arrows, skips disabled items and loops', async () => {
    const user = userEvent.setup();
    render(<><Choices /><button>Next control</button></>);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'One' })).toHaveFocus();
    await user.keyboard('{ArrowRight>}');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Four' })).toHaveFocus());
    expect(screen.getByRole('radio', { name: 'Four' })).toBeChecked();
    await user.keyboard('{/ArrowRight}');
    await user.keyboard('{ArrowRight>}');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'One' })).toHaveFocus());
    expect(screen.getByRole('radio', { name: 'One' })).toBeChecked();
    await user.keyboard('{/ArrowRight}');
    await user.keyboard('{ArrowLeft>}');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Four' })).toBeChecked());
    await user.keyboard('{/ArrowLeft}');
    await user.tab();
    expect(screen.getByText('Next control')).toHaveFocus();
  });

  it('does not select disabled items or disabled groups', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { rerender } = render(<Choices onValueChange={onValueChange} />);
    await user.click(screen.getByRole('radio', { name: 'Two' }));
    expect(onValueChange).not.toHaveBeenCalled();
    rerender(<Choices disabled onValueChange={onValueChange} />);
    await user.click(screen.getByRole('radio', { name: 'Four' }));
    expect(screen.getByRole('radio', { name: 'Four' })).toBeDisabled();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('retains controlled values, refs and class extensions', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(<SegmentedControl aria-label="Controlled" value="a" onValueChange={onValueChange} className="feature-group">
      <SegmentedControlItem value="a">A</SegmentedControlItem>
      <SegmentedControlItem value="b" ref={ref} className="feature-item">B</SegmentedControlItem>
    </SegmentedControl>);
    const b = screen.getByRole('radio', { name: 'B' });
    expect(ref.current).toBe(b);
    expect(b).toHaveClass('clanker-segmented-item', 'feature-item');
    await user.click(b);
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('b');
    expect(screen.getByRole('radio', { name: 'A' })).toBeChecked();
  });
});
