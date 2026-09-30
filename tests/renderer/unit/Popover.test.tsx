import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '../../../src/renderer/components/ui/Popover';
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from '../../../src/renderer/components/ui/Dialog';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

function Demo() {
  return <Popover><PopoverTrigger>Open popover</PopoverTrigger><PopoverContent aria-label="Choices" align="start">
    <PopoverClose>Done</PopoverClose>
  </PopoverContent></Popover>;
}
const count = () => useWorkspaceStore.getState().workspaces[0].browserOverlayCount;
beforeEach(() => {
  installElectronApiMock();
  useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'a' })], activeWorkspaceId: 'a', browserOverlayCount: 0 });
});

describe('Popover', () => {
  it('portals, focuses content, acquires suppression, closes on Escape and restores focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<Demo />);
    await user.click(screen.getByText('Open popover'));
    expect(container.contains(screen.getByRole('dialog', { name: 'Choices' }))).toBe(false);
    expect(screen.getByText('Done')).toHaveFocus();
    expect(count()).toBe(1);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(count()).toBe(0);
    await waitFor(() => expect(screen.getByText('Open popover')).toHaveFocus());
  });

  it('dismisses on outside pointer interaction and leaves the outside control focused', async () => {
    const user = userEvent.setup();
    render(<><Demo /><button>Outside</button></>);
    await user.click(screen.getByText('Open popover'));
    await user.click(screen.getByText('Outside'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(count()).toBe(0);
    expect(screen.getByText('Outside')).toHaveFocus();
  });

  it('releases on explicit close and unmount', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Demo />);
    await user.click(screen.getByText('Open popover'));
    await user.click(screen.getByText('Done'));
    expect(count()).toBe(0);
    await user.click(screen.getByText('Open popover'));
    unmount();
    expect(count()).toBe(0);
  });

  it('closes only the nested popover, leaving Dialog focus and its lease intact', async () => {
    const user = userEvent.setup();
    render(<Dialog><DialogTrigger>Open parent</DialogTrigger><DialogContent aria-describedby={undefined}>
      <DialogTitle>Parent</DialogTitle><Demo />
    </DialogContent></Dialog>);
    await user.click(screen.getByText('Open parent'));
    expect(count()).toBe(1);
    await user.click(screen.getByText('Open popover'));
    expect(count()).toBe(2);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Choices' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Parent' })).toBeInTheDocument();
    expect(count()).toBe(1);
    await waitFor(() => expect(screen.getByText('Open popover')).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(count()).toBe(0);
  });
});
