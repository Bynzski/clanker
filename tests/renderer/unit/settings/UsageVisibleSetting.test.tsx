import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installElectronApiMock } from '../../../setup/electron';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HarnessDefaultsSection from '../../../../src/renderer/components/settings/HarnessDefaultsSection';
import { KNOWN_HARNESS_IDS } from '../../../../src/shared/harnessIds';

function renderFor(harnessId: string, usageVisible?: boolean, visible = true) {
  const props = {
    harnessDefaults: Object.fromEntries(KNOWN_HARNESS_IDS.map((id) => [id, { model: '', favorites: [], flags: '', visible: id === harnessId ? visible : true, ...(id === harnessId && usageVisible !== undefined ? { usageVisible } : {}) }])),
    availableHarnessIds: [...KNOWN_HARNESS_IDS], expandedHarness: harnessId, setExpandedHarness: vi.fn(),
    harnessModelCache: {}, harnessModelLoading: {}, loadHarnessModels: vi.fn().mockResolvedValue(undefined),
    handleSetHarnessFlags: vi.fn().mockResolvedValue(undefined), handleSetHarnessVisible: vi.fn().mockResolvedValue(undefined),
    handleSetHarnessAttention: vi.fn().mockResolvedValue(undefined), handleSetHarnessUsageVisible: vi.fn().mockResolvedValue(undefined),
    handleSetDefaultModel: vi.fn().mockResolvedValue(undefined), handleToggleFavorite: vi.fn().mockResolvedValue(undefined),
  };
  render(<HarnessDefaultsSection {...props} />);
  return props;
}

describe('Show in Usage setting', () => {
  // Account-capable harnesses render an accounts row that reads through the bridge.
  beforeEach(() => { installElectronApiMock(); });

  it.each([['codex', 'Codex'], ['claude', 'Claude'], ['omp', 'Oh My Pi'], ['hermes', 'Hermes'], ['agy', 'Antigravity']])(
    'is offered for %s, checked by default (legacy defaults), and persists changes through the handler', async (id, label) => {
      const props = renderFor(id);
      const box = screen.getByRole('checkbox', { name: `Show ${label} in Usage` });
      expect(box).toBeChecked();
      expect(screen.getByText('Show in Usage')).toBeInTheDocument();
      await userEvent.click(box);
      expect(props.handleSetHarnessUsageVisible).toHaveBeenCalledExactlyOnceWith(id, false);
    });

  it('reflects an explicit false and can turn it back on', async () => {
    const props = renderFor('claude', false);
    const box = screen.getByRole('checkbox', { name: 'Show Claude in Usage' });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(props.handleSetHarnessUsageVisible).toHaveBeenCalledWith('claude', true);
  });

  it.each([['opencode', 'OpenCode'], ['pi', 'Pi']])('is not offered for %s (no usage capability)', (id, label) => {
    renderFor(id);
    expect(screen.queryByRole('checkbox', { name: `Show ${label} in Usage` })).not.toBeInTheDocument();
    expect(screen.queryByText('Show in Usage')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: `Agent attention for ${label}` })).toBeInTheDocument(); // the rest of the panel is unchanged
  });

  it('is independent of the launcher visibility setting in both directions', async () => {
    const hiddenFromLauncher = renderFor('codex', true, false);
    expect(screen.getByRole('checkbox', { name: 'Show Codex in Usage' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show Codex' }));
    expect(hiddenFromLauncher.handleSetHarnessVisible).toHaveBeenCalledWith('codex', true);
    expect(hiddenFromLauncher.handleSetHarnessUsageVisible).not.toHaveBeenCalled();
  });

  it('turning usage off does not touch launcher visibility', async () => {
    const props = renderFor('codex', true, true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show Codex in Usage' }));
    expect(props.handleSetHarnessVisible).not.toHaveBeenCalled();
  });
});
