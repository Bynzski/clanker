// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceTargetPicker } from '../../../src/renderer/components/workspaceOpen/WorkspaceTargetPicker';
import { installElectronApiMock } from '../../setup/electron';

const environments = [
  { id: 'alpha', kind: 'ssh' as const, label: 'Alpha', target: 'dev@alpha', defaultWorkspaceRoot: '/srv/workspaces' },
  { id: 'beta', kind: 'ssh' as const, label: 'Beta', target: 'dev@beta' },
];

function show() {
  const onSelect = vi.fn();
  const onAddServer = vi.fn();
  render(<WorkspaceTargetPicker value="local" environments={environments}
    disabled={false} onSelect={onSelect} onAddServer={onAddServer} onSettings={vi.fn()} />);
  return { onSelect, onAddServer };
}

describe('Workspace target picker', () => {
  beforeEach(() => { installElectronApiMock(); });

  it('supports search, arrow navigation, selection, and focus return', async () => {
    const user = userEvent.setup();
    const { onSelect } = show();
    const trigger = screen.getByRole('button', { name: 'Choose location: This PC' });
    await user.click(trigger);
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await user.type(screen.getByRole('searchbox'), 'beta');
    expect(screen.queryByRole('button', { name: 'Alpha, dev@alpha' })).toBeNull();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Beta, dev@beta' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('beta');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps adding available for an empty search and restores focus on Escape', async () => {
    const user = userEvent.setup();
    const { onAddServer } = show();
    const trigger = screen.getByRole('button', { name: 'Choose location: This PC' });
    await user.click(trigger);
    await user.type(screen.getByRole('searchbox'), 'missing');
    expect(screen.getByRole('status')).toHaveTextContent('No matching locations');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Add server…' }));
    expect(onAddServer).toHaveBeenCalledOnce();
  });
});
