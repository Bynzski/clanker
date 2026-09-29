// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import HarnessDefaultsSection from '../../../../src/renderer/components/settings/HarnessDefaultsSection';

const providerModel = 'hermes-provider:openrouter:anthropic%2Fclaude-sonnet';
const catalog = [{ id: providerModel, label: 'OpenRouter · anthropic/claude-sonnet' }];

function renderHermes(model = '', models = catalog) {
  const handleSetDefaultModel = vi.fn().mockResolvedValue(undefined);
  const props = {
    harnessDefaults: { hermes: { model, favorites: [], flags: '', visible: true } },
    availableHarnessIds: ['hermes'],
    expandedHarness: 'hermes',
    setExpandedHarness: vi.fn(),
    harnessModelCache: { hermes: models },
    harnessModelLoading: {},
    loadHarnessModels: vi.fn().mockResolvedValue(undefined),
    handleSetHarnessFlags: vi.fn().mockResolvedValue(undefined),
    handleSetHarnessVisible: vi.fn().mockResolvedValue(undefined),
    handleSetHarnessAttention: vi.fn().mockResolvedValue(undefined),
    handleSetDefaultModel,
    handleToggleFavorite: vi.fn().mockResolvedValue(undefined),
  };
  const view = render(<HarnessDefaultsSection {...props} />);
  return { ...view, props, handleSetDefaultModel };
}

describe('Hermes default model settings', () => {
  it('saves a provider-aware catalog choice and shows its label without enabling attention', () => {
    const { rerender, props, handleSetDefaultModel } = renderHermes();
    fireEvent.change(screen.getByRole('combobox', { name: 'Hermes default model' }), { target: { value: providerModel } });
    expect(handleSetDefaultModel).toHaveBeenCalledWith('hermes', providerModel);
    rerender(<HarnessDefaultsSection {...props} harnessDefaults={{ hermes: { ...props.harnessDefaults.hermes, model: providerModel } }} />);
    expect(screen.getByText('anthropic/claude-sonnet · OpenRouter', { selector: '.harness-defaults-current' })).toBeTruthy();
    const attention = screen.getByRole('checkbox', { name: 'Agent attention for Hermes' });
    expect(attention).toBeEnabled();
    expect(attention).not.toBeChecked();
    expect(attention.title).toContain('SSH launches');
    fireEvent.click(attention);
    expect(props.handleSetHarnessAttention).toHaveBeenCalledWith('hermes', true);
  });

  it('keeps an undiscovered manual default selectable and allows changing to a custom model', () => {
    const { handleSetDefaultModel } = renderHermes('manual/original');
    expect((screen.getByRole('combobox', { name: 'Hermes default model' }) as HTMLSelectElement).value).toBe('manual/original');
    expect(screen.getByText('manual/original', { selector: '.harness-defaults-current' }).className).not.toContain('unresolved');
    fireEvent.click(screen.getByRole('button', { name: 'Enter custom model' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Hermes custom model' }), { target: { value: 'manual/new' } });
    expect(handleSetDefaultModel).toHaveBeenCalledWith('hermes', 'manual/new');
  });

  it('uses free text when model discovery is unavailable', () => {
    const { handleSetDefaultModel } = renderHermes('', []);
    fireEvent.change(screen.getByRole('textbox', { name: 'Hermes default model' }), { target: { value: 'custom/offline' } });
    expect(handleSetDefaultModel).toHaveBeenCalledWith('hermes', 'custom/offline');
  });

  it('distinguishes matching slugs by provider and preserves the saved model on refresh', () => {
    const codex = 'hermes-provider:codex:gpt-5.3-codex-900k';
    const copilot = 'hermes-provider:copilot:gpt-5.3-codex-900k';
    const models = [
      { id: codex, label: 'ChatGPT or Codex Subscription · gpt-5.3-codex-900k' },
      { id: copilot, label: 'gpt-5.3-codex-900k · GitHub Copilot' },
    ];
    const { rerender, props } = renderHermes(codex, models);
    const select = screen.getByRole('combobox', { name: 'Hermes default model' }) as HTMLSelectElement;
    expect(select.value).toBe(codex);
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Use harness default',
      'gpt-5.3-codex-900k · ChatGPT or Codex Subscription',
      'gpt-5.3-codex-900k · GitHub Copilot',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Hermes models' }));
    expect(props.loadHarnessModels).toHaveBeenCalledWith('hermes', true);
    const updated = [...models, { id: 'hermes-provider:openrouter:anthropic%2Fclaude-opus', label: 'OpenRouter · anthropic/claude-opus' }];
    rerender(<HarnessDefaultsSection {...props} harnessModelCache={{ hermes: updated }} />);
    expect(select.value).toBe(codex);
    expect(Array.from(select.options).pop()?.textContent).toBe('anthropic/claude-opus · OpenRouter');
  });
});

describe('Antigravity default settings', () => {
  it('allows enabling agent attention for Antigravity', () => {
    const handleSetHarnessAttention = vi.fn().mockResolvedValue(undefined);
    const props = {
      harnessDefaults: { agy: { model: '', favorites: [], flags: '', visible: true, attentionEnabled: false } },
      availableHarnessIds: ['agy'],
      expandedHarness: 'agy',
      setExpandedHarness: vi.fn(),
      harnessModelCache: { agy: [] },
      harnessModelLoading: {},
      loadHarnessModels: vi.fn().mockResolvedValue(undefined),
      handleSetHarnessFlags: vi.fn().mockResolvedValue(undefined),
      handleSetHarnessVisible: vi.fn().mockResolvedValue(undefined),
      handleSetHarnessAttention,
      handleSetDefaultModel: vi.fn().mockResolvedValue(undefined),
      handleToggleFavorite: vi.fn().mockResolvedValue(undefined),
    };
    render(<HarnessDefaultsSection {...props} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Agent attention for Antigravity' });
    expect(checkbox).not.toBeDisabled();
    fireEvent.click(checkbox);
    expect(handleSetHarnessAttention).toHaveBeenCalledWith('agy', true);
  });
});
