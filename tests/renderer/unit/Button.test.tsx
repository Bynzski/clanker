import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../../../src/renderer/components/ui/Button';
import { IconButton } from '../../../src/renderer/components/ui/IconButton';

describe('Button', () => {
  it('retains native click/keyboard activation and ref while defaulting to a non-submit action', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    const submit = vi.fn((event) => event.preventDefault());
    const ref = createRef<HTMLButtonElement>();
    render(<form onSubmit={submit}><Button ref={ref} onClick={action}>Launch</Button></form>);
    const button = screen.getByRole('button', { name: 'Launch' });
    expect(ref.current).toBe(button);
    expect(button).toHaveAttribute('type', 'button');
    await user.click(button);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(action).toHaveBeenCalledTimes(3);
    expect(submit).not.toHaveBeenCalled();
  });

  it('supports explicit submit semantics', async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={submit}><Button type="submit">Save</Button></form>);
    await user.click(screen.getByText('Save'));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('keeps disabled buttons inert and out of the tab order', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(<><Button disabled onClick={action}>Disabled</Button><Button>Enabled</Button></>);
    await user.click(screen.getByText('Disabled'));
    await user.tab();
    expect(screen.getByText('Enabled')).toHaveFocus();
    expect(action).not.toHaveBeenCalled();
  });

  it.each(['primary', 'secondary', 'danger'] as const)('exposes the %s variant and size without losing feature classes', (variant) => {
    render(<Button variant={variant} size="sm" className="feature-action">Action</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('data-variant', variant);
    expect(button).toHaveAttribute('data-size', 'sm');
    expect(button).toHaveClass('clanker-button', 'feature-action');
  });
});

describe('IconButton', () => {
  it('requires/exposes a name and shares native behavior and refs', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(<IconButton aria-label="Configure harness" ref={ref} onClick={action}><svg aria-hidden="true" /></IconButton>);
    const button = screen.getByRole('button', { name: 'Configure harness' });
    expect(ref.current).toBe(button);
    expect(button).toHaveClass('clanker-button', 'clanker-icon-button');
    await user.click(button);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('supports a referenced label and disabled semantics', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(<><span id="configure-label">Configure</span><IconButton aria-labelledby="configure-label" disabled onClick={action}><svg aria-hidden="true" /></IconButton></>);
    const button = screen.getByRole('button', { name: 'Configure' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(action).not.toHaveBeenCalled();
  });
});
