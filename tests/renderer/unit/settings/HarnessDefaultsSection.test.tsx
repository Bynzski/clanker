// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HarnessDefaultsSection from '../../../../src/renderer/components/settings/HarnessDefaultsSection';
import type { ModelOption } from '../../../../src/renderer/types/shared';
import { installElectronApiMock } from '../../../setup/electron';
import { useWorkspaceStore } from '../../../../src/renderer/store/workspaceStore';

const providerModel = 'hermes-provider:openrouter:anthropic%2Fclaude-sonnet';
const catalog = [{ id: providerModel, label: 'OpenRouter · anthropic/claude-sonnet' }];
const models = [{ id: 'provider/z', label: 'Zulu' }, { id: 'provider/a', label: 'Alpha' }, { id: 'provider/b', label: 'Beta' }];

function renderSettings({ harness = 'hermes', model = '', options = catalog, favorites = [], loading = false }: {
  harness?: string; model?: string; options?: ModelOption[]; favorites?: string[]; loading?: boolean;
} = {}) {
  const props = {
    availableHarnessIds: [harness], expandedHarness: harness, setExpandedHarness: vi.fn(),
    harnessModelCache: { [harness]: options }, harnessModelLoading: { [harness]: loading },
    loadHarnessModels: vi.fn().mockResolvedValue(undefined),
    handleSetHarnessFlags: vi.fn().mockResolvedValue(undefined),
    handleSetHarnessVisible: vi.fn().mockResolvedValue(undefined),
    handleSetHarnessAttention: vi.fn().mockResolvedValue(undefined),
    handleSetHarnessUsageVisible: vi.fn().mockResolvedValue(undefined),
    handleSetHarnessAgentBridge: vi.fn().mockResolvedValue(undefined),
    handleSetDefaultModel: vi.fn().mockResolvedValue(undefined),
    handleToggleFavorite: vi.fn().mockResolvedValue(undefined),
  };
  function Settings({ entries, busy }: { entries: ModelOption[]; busy: boolean }) {
    const [selected, setSelected] = useState(model);
    const [starred, setStarred] = useState(favorites);
    return <HarnessDefaultsSection {...props}
      harnessModelCache={{ [harness]: entries }} harnessModelLoading={{ [harness]: busy }}
      harnessDefaults={{ [harness]: { model: selected, favorites: starred, flags: '', visible: true } }}
      handleSetDefaultModel={async (id, value) => { await props.handleSetDefaultModel(id, value); setSelected(value); }}
      handleToggleFavorite={async (id, value) => {
        await props.handleToggleFavorite(id, value);
        setStarred((current) => current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]);
      }} />;
  }
  const view = render(<Settings entries={options} busy={loading} />);
  return { ...view, props, update: (entries: ModelOption[], busy = false) => view.rerender(<Settings entries={entries} busy={busy} />) };
}
const order = () => Array.from(screen.getByRole('group', { name: 'Models' }).querySelectorAll('.searchable-picker-label'), (node) => node.textContent);
beforeEach(() => {
  installElectronApiMock();
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, browserOverlayCount: 0 });
});

describe('searchable harness default settings', () => {
  it.each(['codex', 'opencode', 'agy', 'hermes'])('uses a searchable picker for discovered %s models and persists selection', async (harness) => {
    const user = userEvent.setup();
    const { container, props } = renderSettings({ harness, model: 'provider/a', options: models });
    const trigger = container.querySelector('.model-pill')!;
    expect(container.querySelector('select')).toBeNull();
    expect(trigger).toHaveTextContent('Alpha');
    await user.click(trigger);
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await user.type(screen.getByRole('searchbox'), 'provider/b');
    expect(order()).toEqual(['Beta']);
    await user.keyboard('{Enter}');
    expect(props.handleSetDefaultModel).toHaveBeenCalledExactlyOnceWith(harness, 'provider/b');
    await waitFor(() => expect(trigger).toHaveTextContent('Beta'));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('sorts favorites first, saves star/unstar without closing, and offers an unstarred harness default', async () => {
    const user = userEvent.setup();
    const { props, container } = renderSettings({ harness: 'codex', options: models, favorites: ['provider/z'] });
    const trigger = screen.getByRole('button', { name: 'Codex default model' });
    await user.click(trigger);
    expect(order()).toEqual(['Zulu', 'Alpha', 'Beta', 'Use harness default']);
    const add = screen.getByRole('button', { name: 'Add Beta to favorites' });
    expect(add).toHaveClass('clanker-icon-button');
    await user.click(add);
    expect(props.handleToggleFavorite).toHaveBeenLastCalledWith('codex', 'provider/b');
    await waitFor(() => expect(order()).toEqual(['Beta', 'Zulu', 'Alpha', 'Use harness default']));
    const remove = screen.getByRole('button', { name: 'Remove Beta from favorites' });
    await waitFor(() => expect(remove).toHaveFocus());
    await user.click(remove);
    expect(props.handleToggleFavorite).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(order()).toEqual(['Zulu', 'Alpha', 'Beta', 'Use harness default']));
    expect(screen.getByRole('dialog', { name: 'Models' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Use harness default to favorites' })).not.toBeInTheDocument();
    expect(container.querySelector('.harness-defaults-favorites')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Use harness default' }));
    expect(props.handleSetDefaultModel).toHaveBeenLastCalledWith('codex', '');
    expect(props.handleToggleFavorite).not.toHaveBeenCalledWith('codex', '');
  });

  it('navigates both directions, scrolls active choices, and restores focus after Escape', async () => {
    const scroll = vi.fn();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    try {
      const user = userEvent.setup();
      renderSettings({ harness: 'codex', options: models });
      const trigger = screen.getByRole('button', { name: 'Codex default model' });
      await user.click(trigger);
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('button', { name: 'Alpha' })).toHaveFocus();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('button', { name: 'Beta' })).toHaveFocus();
      await user.keyboard('{ArrowUp}');
      expect(screen.getByRole('button', { name: 'Alpha' })).toHaveFocus();
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });
      await user.keyboard('{Escape}');
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(screen.queryByRole('dialog', { name: 'Models' })).not.toBeInTheDocument();
    } finally {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });

  it('preserves and marks unresolved current models and favorites', async () => {
    const user = userEvent.setup();
    renderSettings({ harness: 'codex', model: 'provider/missing', options: models, favorites: ['old-favorite'] });
    const trigger = screen.getByRole('button', { name: 'Codex default model' });
    expect(trigger).toHaveTextContent('provider/missing');
    expect(within(trigger).getByLabelText('Model unavailable')).toBeInTheDocument();
    await user.click(trigger);
    const current = screen.getByRole('button', { name: /provider\/missing.*Unavailable/, pressed: true });
    expect(within(current).getByLabelText('Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove old-favorite from favorites' })).toBeEnabled();
  });

  it('disables loading discovery without losing a selected label', async () => {
    const user = userEvent.setup();
    const { update, props } = renderSettings({ harness: 'codex', model: 'provider/a', options: models, loading: true });
    const trigger = screen.getByRole('button', { name: 'Codex default model' });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent('Alpha');
    await user.click(trigger);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(props.handleSetDefaultModel).not.toHaveBeenCalled();
    update(models);
    expect(trigger).toBeEnabled();
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Models' })).toBeInTheDocument();
    update(models, true);
    expect(screen.queryByRole('dialog', { name: 'Models' })).not.toBeInTheDocument();
    update(models);
    expect(screen.queryByRole('dialog', { name: 'Models' })).not.toBeInTheDocument();
  });

  it('shows discovery loading on an empty collection', () => {
    renderSettings({ harness: 'codex', options: [], loading: true });
    expect(screen.getByRole('button', { name: 'Codex default model' })).toHaveTextContent('Discovering models…');
    expect(screen.getByRole('button', { name: 'Codex default model' })).toBeDisabled();
  });

  it('keeps settings width bounded and long labels truncated in both trigger and scrolling results', async () => {
    const user = userEvent.setup();
    const long = 'provider/' + 'long-model-identifier'.repeat(20);
    const { container } = renderSettings({ harness: 'opencode', model: long, options: [{ id: long, label: long }] });
    const style = document.createElement('style');
    style.textContent = ['Header.css', 'ModelSearchPicker.css', 'ui/Popover.css', 'ui/SearchablePicker.css'].map((file) =>
      readFileSync(resolve(__dirname, '../../../../src/renderer/components', file), 'utf8')).join('\n');
    document.head.append(style);
    container.classList.add('settings-dropdown');
    try {
      expect(getComputedStyle(container).width).toBe('360px');
      expect(getComputedStyle(container).maxWidth).toBe('calc(100vw - 16px)');
      expect(getComputedStyle(container).minWidth).toBe('0px');
      const trigger = screen.getByRole('button', { name: 'OpenCode default model' });
      expect(getComputedStyle(trigger).width).toBe('100%');
      expect(getComputedStyle(trigger).height).toBe('28px');
      expect(getComputedStyle(trigger).minWidth).toBe('0px');
      expect(getComputedStyle(trigger.querySelector('.model-pill-label')!).textOverflow).toBe('ellipsis');
      await user.click(trigger);
      const picker = screen.getByRole('dialog', { name: 'Models' });
      expect(getComputedStyle(picker).width).toBe('320px');
      expect(getComputedStyle(picker).maxHeight).toBe('var(--radix-popover-content-available-height)');
      expect(getComputedStyle(picker.querySelector('.searchable-picker-results')!).overflowY).toBe('auto');
      expect(getComputedStyle(picker.querySelector('.searchable-picker-results')!).maxHeight).toBe('300px');
      expect(getComputedStyle(picker.querySelector('.searchable-picker-label')!).textOverflow).toBe('ellipsis');
    } finally { style.remove(); }
  });

  it('retains shared free-form Input for Claude', () => {
    const { props } = renderSettings({ harness: 'claude', model: 'custom', options: [] });
    const input = screen.getByRole('textbox', { name: 'Claude default model' });
    expect(input).toHaveClass('clanker-input');
    fireEvent.change(input, { target: { value: 'new-custom' } });
    expect(props.handleSetDefaultModel).toHaveBeenCalledWith('claude', 'new-custom');
    expect(screen.queryByRole('button', { name: 'Claude default model' })).not.toBeInTheDocument();
  });

  it('allows enabling agent attention for Antigravity', () => {
    const { props } = renderSettings({ harness: 'agy', options: models });
    const checkbox = screen.getByRole('checkbox', { name: 'Agent attention for Antigravity' });
    expect(checkbox).toBeEnabled();
    fireEvent.click(checkbox);
    expect(props.handleSetHarnessAttention).toHaveBeenCalledWith('agy', true);
  });
});

describe('Clanker bridge setting', () => {
  it.each(['claude', 'codex', 'opencode', 'pi'])('offers the opt-in for %s, off by default, and persists the choice', (harness) => {
    const { props } = renderSettings({ harness, options: models });
    const checkbox = screen.getByRole('checkbox', { name: /Clanker bridge for/ });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(props.handleSetHarnessAgentBridge).toHaveBeenCalledWith(harness, true);
  });

  it.each(['omp', 'hermes', 'agy'])('has no bridge row for %s, which cannot attach it', (harness) => {
    renderSettings({ harness, options: models });
    expect(screen.queryByRole('checkbox', { name: /Clanker bridge/ })).not.toBeInTheDocument();
  });
});

describe('Hermes model settings', () => {
  it('saves a provider-aware choice without enabling attention', async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Hermes default model' }));
    await user.type(screen.getByRole('searchbox'), 'claude-sonnet');
    await user.keyboard('{Enter}');
    expect(props.handleSetDefaultModel).toHaveBeenCalledWith('hermes', providerModel);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hermes default model' })).toHaveTextContent('anthropic/claude-sonnet · OpenRouter'));
    const attention = screen.getByRole('checkbox', { name: 'Agent attention for Hermes' });
    expect(attention).not.toBeChecked();
    expect(attention.title).toContain('SSH launches');
    fireEvent.click(attention);
    expect(props.handleSetHarnessAttention).toHaveBeenCalledWith('hermes', true);
  });

  it('preserves custom models, allows manual entry, and returns to browsing', async () => {
    const user = userEvent.setup();
    const { props } = renderSettings({ model: 'manual/original' });
    const trigger = screen.getByRole('button', { name: 'Hermes default model' });
    expect(trigger).toHaveTextContent('manual/original');
    expect(within(trigger).queryByLabelText('Model unavailable')).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByRole('button', { name: 'manual/original', pressed: true })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enter custom model' }));
    const custom = screen.getByRole('textbox', { name: 'Hermes custom model' });
    expect(custom).toHaveClass('clanker-input');
    expect(custom).toHaveFocus();
    await user.clear(custom);
    await user.type(custom, 'manual/new');
    expect(props.handleSetDefaultModel).toHaveBeenLastCalledWith('hermes', 'manual/new');
    await user.click(screen.getByRole('button', { name: 'Browse Hermes models' }));
    expect(screen.getByRole('button', { name: 'Hermes default model' })).toHaveTextContent('manual/new');
    await user.click(screen.getByRole('button', { name: 'Hermes default model' }));
    expect(screen.getByRole('button', { name: 'manual/new', pressed: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'manual/original' })).not.toBeInTheDocument();
  });

  it('retains manual entry and refresh when discovery is unavailable', () => {
    const { props } = renderSettings({ options: [] });
    fireEvent.change(screen.getByRole('textbox', { name: 'Hermes default model' }), { target: { value: 'custom/offline' } });
    expect(props.handleSetDefaultModel).toHaveBeenCalledWith('hermes', 'custom/offline');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Hermes models' }));
    expect(props.loadHarnessModels).toHaveBeenCalledWith('hermes', true);
  });

  it('distinguishes provider-qualified models and preserves selection during refresh', async () => {
    const user = userEvent.setup();
    const codex = 'hermes-provider:codex:gpt-5.3-codex-900k';
    const copilot = 'hermes-provider:copilot:gpt-5.3-codex-900k';
    const entries = [
      { id: codex, label: 'ChatGPT or Codex Subscription · gpt-5.3-codex-900k' },
      { id: copilot, label: 'gpt-5.3-codex-900k · GitHub Copilot' },
    ];
    const { update, props } = renderSettings({ model: codex, options: entries });
    const trigger = screen.getByRole('button', { name: 'Hermes default model' });
    await user.click(trigger);
    expect(screen.getByRole('button', { name: 'gpt-5.3-codex-900k · ChatGPT or Codex Subscription', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'gpt-5.3-codex-900k · GitHub Copilot', pressed: false })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'hermes-provider:copilot:');
    expect(order()).toEqual(['gpt-5.3-codex-900k · GitHub Copilot']);
    await user.click(screen.getByRole('button', { name: 'Refresh Hermes models' }));
    expect(props.loadHarnessModels).toHaveBeenCalledWith('hermes', true);
    update(entries, true);
    expect(trigger).toBeDisabled();
    update([...entries, { id: providerModel, label: catalog[0].label }]);
    expect(trigger).toHaveTextContent('gpt-5.3-codex-900k · ChatGPT or Codex Subscription');
    expect(props.handleSetDefaultModel).not.toHaveBeenCalled();
    await user.click(trigger);
    expect(screen.getByRole('button', { name: 'anthropic/claude-sonnet · OpenRouter' })).toBeInTheDocument();
  });
});
