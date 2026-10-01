// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import WorkspaceGateContent from '../../../src/renderer/components/WorkspaceGateContent';
import SshEnvironmentManager from '../../../src/renderer/components/SshEnvironmentManager';
import WorktreeLauncher from '../../../src/renderer/components/WorktreeLauncher';
import { WorkspaceTargetPicker } from '../../../src/renderer/components/gate/WorkspaceTargetPicker';
import { installElectronApiMock } from '../../setup/electron';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { THEME_IDS } from '../../../src/shared/types/theme';

describe('Workspace Gate visual rendering across themes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installElectronApiMock();
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
    });
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('data-theme');
  });

  it.each(THEME_IDS)('renders Gate launcher and location picker in %s theme', (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    render(
      <WorkspaceGateContent
        onSubmit={vi.fn()}
        fullscreen
      />
    );

    expect(screen.getByRole('heading', { name: 'Clanker Grid' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Launch Workspace/i })).toBeInTheDocument();
  });

  it.each(THEME_IDS)('renders SSH Environment Manager in %s theme', (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    render(
      <SshEnvironmentManager
        environments={[{ id: 'srv-1', kind: 'ssh', label: 'Staging Server', target: 'deploy@10.0.0.1' }]}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Manage SSH Targets' })).toBeInTheDocument();
    expect(screen.getByLabelText('Label')).toHaveValue('');
    expect(screen.getByText('Staging Server')).toBeInTheDocument();
  });

  it.each(THEME_IDS)('renders Worktree flows in %s theme', (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    render(
      <WorktreeLauncher
        launchReady
        repoPath="/projects/clanker"
        openPaths={[]}
        onOpenPath={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Load repository' })).toBeInTheDocument();
  });

  it.each(THEME_IDS)('renders WorkspaceTargetPicker in %s theme', (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    render(
      <WorkspaceTargetPicker
        value="local"
        environments={[{ id: 'srv-1', kind: 'ssh', label: 'Remote VPS', target: 'user@host' }]}
        localRoot="/home/user"
        settingsBusy={false}
        disabled={false}
        onSelect={vi.fn()}
        onAddServer={vi.fn()}
        onSettings={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Choose location: This PC/i })).toBeInTheDocument();
  });
});
