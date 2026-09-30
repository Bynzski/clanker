import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelPicker } from '../../../src/renderer/components/gate/ModelPicker';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';

const models = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'g', label: 'Gamma' }];
function Demo({ harness = 'codex', initial = 'a', empty = false, onSelect = () => {}, onToggle = () => {}, onRefresh = () => {} }: {
  harness?: string; initial?: string; empty?: boolean; onSelect?: (value: string) => void;
  onToggle?: (value: string) => void; onRefresh?: () => void;
}) {
  const [model, setModel] = useState(initial);
  const [favorites, setFavorites] = useState(['a', 'b']);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  return <ModelPicker harness={harness} model={model} models={empty ? [] : models} sortedModels={empty ? [] : models}
    favorites={favorites} savedHermesModel="g" refreshing={false} favoritesOpen={favoritesOpen} discoveryOpen={discoveryOpen}
    onFavoritesOpenChange={setFavoritesOpen} onDiscoveryOpenChange={setDiscoveryOpen}
    onSelect={(value) => { setModel(value); onSelect(value); }} onToggleFavorite={(value) => {
      onToggle(value); setFavorites((current) => current.includes(value) ? current.filter((id) => id !== value) : [...current, value]);
    }} onRefreshHermes={onRefresh} isUnresolved={(value) => harness !== 'hermes' && !!value && !models.some((item) => item.id === value)} />;
}
beforeEach(() => {
  installElectronApiMock();
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, browserOverlayCount: 0 });
});
async function browse(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Change model' }));
  await user.click(screen.getByRole('button', { name: 'Browse all models' }));
  return screen.getByRole('dialog', { name: 'All Models' });
}

describe('ModelPicker', () => {
  it('opens favorites, exposes selection, selects by keyboard and restores the trigger', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Demo onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Change model' }));
    const favorites = screen.getByRole('dialog', { name: 'Favorite models' });
    expect(within(favorites).getByRole('button', { name: 'Alpha', pressed: true })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Remove Alpha from favorites' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Beta', pressed: false })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('b');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change model' })).toHaveFocus());
    expect(screen.getByTitle('Change model')).toHaveTextContent('Beta');
  });

  it('removes a favorite without selecting it and leaves the picker open', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    render(<Demo onSelect={onSelect} onToggle={onToggle} />);
    await user.click(screen.getByRole('button', { name: 'Change model' }));
    await user.click(screen.getByRole('button', { name: 'Remove Beta from favorites' }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('b');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Favorite models' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument();
  });

  it('hands favorites off to All Models with search focused and one overlay lease', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await browse(user);
    expect(screen.queryByRole('dialog', { name: 'Favorite models' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search models' })).toHaveFocus());
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(1);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change model' })).toHaveFocus());
    expect(useWorkspaceStore.getState().browserOverlayCount).toBe(0);
  });

  it('filters search, navigates with arrows and selects the focused matching model with Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Demo onSelect={onSelect} />);
    const dialog = await browse(user);
    await user.type(screen.getByRole('searchbox'), 'a');
    await user.keyboard('{ArrowDown}');
    expect(within(dialog).getByRole('button', { name: 'Alpha', pressed: true })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(dialog).getByRole('button', { name: 'Beta', pressed: false })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(within(dialog).getByRole('button', { name: 'Alpha' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'gamma');
    expect(within(dialog).queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument();
    await user.keyboard('{ArrowUp}');
    expect(within(dialog).getByRole('button', { name: 'Gamma' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('g');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows no matches safely and toggles stars independently of selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    render(<Demo onSelect={onSelect} onToggle={onToggle} />);
    await browse(user);
    await user.click(screen.getByRole('button', { name: 'Add Gamma to favorites' }));
    expect(screen.getByRole('button', { name: 'Remove Gamma from favorites' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Gamma from favorites' }));
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
    await user.type(screen.getByRole('searchbox'), 'no-such-model');
    expect(screen.getByRole('status')).toHaveTextContent('No models found');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('preserves unresolved model display', () => {
    render(<Demo initial="missing-model" />);
    expect(screen.getByTitle('Change model')).toHaveTextContent('missing-model');
    expect(screen.getByTitle('Change model')).toHaveAccessibleDescription('Model is unavailable');
    expect(document.querySelector('.model-pill-label')).toHaveClass('unresolved');
    expect(document.querySelector('.model-pill-warning')).toBeInTheDocument();
  });

  it('supports Hermes custom entry and its saved default', async () => {
    const user = userEvent.setup();
    render(<Demo harness="hermes" />);
    await user.type(screen.getByRole('textbox', { name: 'Hermes model' }), 'custom/model');
    expect(screen.getByRole('textbox', { name: 'Hermes model' })).toHaveValue('custom/model');
    await user.click(screen.getByRole('button', { name: 'Change model' }));
    await user.click(screen.getByRole('button', { name: 'Use saved default' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTitle('Change model')).toHaveTextContent('Gamma');
  });

  it('offers Hermes refresh and custom input without discovered models', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<Demo harness="hermes" initial="" empty onRefresh={onRefresh} />);
    await user.type(screen.getByRole('textbox', { name: 'Hermes model' }), 'custom/model');
    expect(screen.getByRole('textbox')).toHaveValue('custom/model');
    await user.click(screen.getByRole('button', { name: 'Refresh Hermes models' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
