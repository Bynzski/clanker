import { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchablePicker } from '../../../src/renderer/components/ui/SearchablePicker';
import { installElectronApiMock } from '../../setup/electron';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';

const items = [{ id: 'z', label: 'Zulu' }, { id: 'b', label: 'Beta', searchText: 'provider-b' }, { id: 'a', label: 'Alpha' }];
function Demo({ save = async () => {}, onSelect = () => {} }: { save?: (id: string) => Promise<void>; onSelect?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [favorites, setFavorites] = useState(['z', 'a']);
  return <SearchablePicker label="Models" trigger={<button>Choose model</button>} items={items} value="a"
    open={open} onOpenChange={setOpen} onSelect={onSelect} favorites={favorites}
    onToggleFavorite={async (id) => {
      await save(id);
      setFavorites((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    }} />;
}
const order = () => Array.from(screen.getByRole('group', { name: 'Models' }).querySelectorAll('.searchable-picker-label'), (node) => node.textContent);
beforeEach(() => {
  installElectronApiMock();
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, browserOverlayCount: 0 });
});

describe('SearchablePicker', () => {
  it('focuses search and puts favorites first alphabetically regardless of stored order', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole('button', { name: 'Choose model' }));
    expect(screen.getByRole('searchbox', { name: 'Search models' })).toHaveFocus();
    expect(order()).toEqual(['Alpha', 'Zulu', 'Beta']);
    await user.click(screen.getByRole('button', { name: 'Add Beta to favorites' }));
    await waitFor(() => expect(order()).toEqual(['Alpha', 'Beta', 'Zulu']));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Beta from favorites' })).toHaveFocus());
    expect(screen.getByRole('dialog', { name: 'Models' })).toBeInTheDocument();
  });
  it('searches identifiers/providers, navigates results, and restores focus after selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Demo onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Choose model' }));
    await user.type(screen.getByRole('searchbox'), 'provider-b');
    expect(order()).toEqual(['Beta']);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('b');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose model' })).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('shows empty results, dismisses with Escape, and resets search on reopening', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole('button', { name: 'Choose model' }));
    await user.type(screen.getByRole('searchbox'), 'missing');
    expect(screen.getByRole('status')).toHaveTextContent('No matches found');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose model' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Choose model' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(order()).toEqual(['Alpha', 'Zulu', 'Beta']);
  });
  it('serializes star saves and shows failures without changing the selected model', async () => {
    const user = userEvent.setup();
    let reject!: (error: Error) => void;
    const save = vi.fn(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const onSelect = vi.fn();
    render(<Demo save={save} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Choose model' }));
    await user.click(screen.getByRole('button', { name: 'Add Beta to favorites' }));
    const stars = within(screen.getByRole('group', { name: 'Models' })).getAllByRole('button', { name: /favorites$/ });
    expect(stars.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Remove Alpha from favorites' }));
    expect(save).toHaveBeenCalledOnce();
    await act(async () => reject(new Error('Save failed')));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save favorite');
    expect(screen.getByRole('button', { name: 'Add Beta to favorites' })).toBeEnabled();
    expect(order()).toEqual(['Alpha', 'Zulu', 'Beta']);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
