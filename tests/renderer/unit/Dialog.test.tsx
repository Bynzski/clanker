import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from '../../../src/renderer/components/ui/Dialog';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from '../../../src/renderer/components/ui/AlertDialog';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

function Demo({ nested = false }: { nested?: boolean }) {
  return <Dialog><DialogTrigger>Open parent</DialogTrigger><DialogContent>
    <DialogTitle>Parent</DialogTitle><DialogDescription>Parent description</DialogDescription>
    <DialogClose>Close parent</DialogClose>
    {nested && <Dialog><DialogTrigger>Open child</DialogTrigger><DialogContent>
      <DialogTitle>Child</DialogTitle><DialogDescription>Child description</DialogDescription>
      <DialogClose>Close child</DialogClose>
    </DialogContent></Dialog>}
  </DialogContent></Dialog>;
}
const count = () => useWorkspaceStore.getState().workspaces[0].browserOverlayCount;
beforeEach(() => {
  installElectronApiMock();
  useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'a' })], activeWorkspaceId: 'a', browserOverlayCount: 0 });
});

describe('Dialog foundation', () => {
  it('portals an accessible dialog, traps focus, closes and restores focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<Demo />);
    expect(count()).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Open parent' }));
    const dialog = screen.getByRole('dialog', { name: 'Parent' });
    expect(dialog).toHaveAccessibleDescription('Parent description');
    expect(container.contains(dialog)).toBe(false);
    expect(screen.getByRole('button', { name: 'Close parent' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close parent' })).toHaveFocus();
    expect(count()).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Close parent' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open parent' })).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(count()).toBe(0);
  });

  it('dismisses with Escape and outside pointer interaction', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByText('Open parent'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByText('Open parent'));
    await user.click(document.querySelector('.clanker-dialog-overlay')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(count()).toBe(0);
  });

  it('Escape closes only the nested dialog and preserves parent suppression/focus', async () => {
    const user = userEvent.setup();
    render(<Demo nested />);
    await user.click(screen.getByText('Open parent'));
    await user.click(screen.getByText('Open child'));
    expect(count()).toBe(2);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Child' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Parent' })).toBeInTheDocument();
    expect(count()).toBe(1);
    await waitFor(() => expect(screen.getByText('Open child')).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(count()).toBe(0);
  });

  it('releases mounted content on unmount', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Demo />);
    await user.click(screen.getByText('Open parent'));
    unmount();
    expect(count()).toBe(0);
  });

  it('AlertDialog focuses cancel, ignores backdrop by default, and supports actions', async () => {
    const user = userEvent.setup();
    render(<AlertDialog><AlertDialogTrigger>Delete</AlertDialogTrigger><AlertDialogContent>
      <AlertDialogTitle>Delete item?</AlertDialogTitle><AlertDialogDescription>Cannot undo</AlertDialogDescription>
      <AlertDialogAction>Confirm</AlertDialogAction><AlertDialogCancel>Cancel</AlertDialogCancel>
    </AlertDialogContent></AlertDialog>);
    await user.click(screen.getByText('Delete'));
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription('Cannot undo');
    expect(screen.getByText('Cancel')).toHaveFocus();
    await user.click(document.querySelector('.clanker-dialog-overlay')!);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByText('Confirm'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(count()).toBe(0);
  });

  it('restores the origin for controlled dialogs without a Radix trigger', async () => {
    function Controlled() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Origin</button>
        <Dialog open={open} onOpenChange={setOpen}><DialogContent>
          <DialogTitle>Controlled</DialogTitle><DialogDescription>Description</DialogDescription>
          <DialogClose>Done</DialogClose>
        </DialogContent></Dialog></>;
    }
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByText('Origin'));
    await user.click(screen.getByText('Done'));
    await waitFor(() => expect(screen.getByText('Origin')).toHaveFocus());
  });
});
