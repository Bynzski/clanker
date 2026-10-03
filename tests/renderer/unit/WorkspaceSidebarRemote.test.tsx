// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceHost from '../../../src/renderer/components/WorkspaceHost';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import type { RemoteFilesChangedEvent } from '../../../src/shared/types/remoteFileWatch';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

vi.mock('../../../src/renderer/components/DynamicPaneLayout', () => ({
  default: ({ workspaceId }: { workspaceId: string }) => <div data-testid="dynamic-pane-layout" data-layout-workspace-id={workspaceId} />,
}));

/**
 * Sidebar composition regression: the single FILES section must stay on the existing
 * FileExplorer/remote path (real FileExplorer, no new SSH transport).
 */
describe('sidebar navigation with a remote workspace', () => {
  let api: ReturnType<typeof installElectronApiMock>;
  let remoteChanged: (event: RemoteFilesChangedEvent) => void;

  beforeEach(() => {
    api = installElectronApiMock({
      fileListDirectory: vi.fn().mockResolvedValue({ success: true, entries: [] }),
      onRemoteFilesChanged: vi.fn((listener) => { remoteChanged = listener; return () => {}; }),
    });
    useWorkspaceNavigationStore.setState({ mode: 'sidebar', resolved: true });
    useWorkspaceStore.setState({
      workspaces: [
        createWorkspaceFixture({ id: 'local-ws', name: 'local', workspacePath: '/workspace', explorerVisible: true, lifecycle: 'active' }),
        createWorkspaceFixture({
          id: 'remote-ws', name: 'remote', workspacePath: '/workspace', environmentId: 'vps', environmentLabel: 'my-vps',
          explorerVisible: true, lifecycle: 'parked',
        }),
      ],
      activeWorkspaceId: 'local-ws',
    });
  });
  afterEach(() => { cleanup(); useWorkspaceNavigationStore.setState({ mode: 'tabs' }); });

  const listedFor = (workspaceId: string) => api.fileListDirectory.mock.calls
    .filter(([request]) => (request as { workspaceId: string }).workspaceId === workspaceId);

  it('keeps one sidebar and one FILES section scoped to the remote workspace on the existing remote path', async () => {
    render(<WorkspaceHost />);
    await waitFor(() => expect(listedFor('local-ws').length).toBeGreaterThan(0));
    expect(api.explorerStartWatching).toHaveBeenCalledWith('local-ws');
    expect(screen.getAllByTestId('workspace-sidebar')).toHaveLength(1);

    api.explorerStartWatching.mockClear();
    api.explorerStopWatching.mockClear();
    act(() => { useWorkspaceStore.getState().selectWorkspace('remote-ws'); });

    // Still exactly one sidebar and one explorer: the section, not a per-surface dock.
    await waitFor(() => expect(listedFor('remote-ws').length).toBeGreaterThan(0));
    expect(screen.getAllByTestId('workspace-sidebar')).toHaveLength(1);
    expect(document.querySelectorAll('.file-explorer')).toHaveLength(1);
    expect(document.querySelector('aside.file-explorer')).toBeNull();
    expect(document.querySelector('.workspace-sidebar .file-explorer-section')).toBeTruthy();

    // Remote identity is intact in the store and shown in the navigator.
    const remote = useWorkspaceStore.getState().getWorkspaceById('remote-ws');
    expect(remote?.environmentId).toBe('vps');
    expect(screen.getByText('SSH · my-vps')).toBeTruthy();

    // Local chokidar is stopped, never started for the remote workspace.
    expect(api.explorerStopWatching).toHaveBeenCalled();
    expect(api.explorerStartWatching).not.toHaveBeenCalled();

    // Remote change events refresh through the same FileExplorer remote handler.
    api.fileListDirectory.mockClear();
    await act(async () => {
      remoteChanged({ workspaceId: 'remote-ws', directoryPaths: ['/workspace'], files: [] });
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(api.fileListDirectory).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'remote-ws', directoryPath: '/workspace' }));

    // Back to local restarts the local watcher; still a single sidebar/explorer.
    act(() => { useWorkspaceStore.getState().selectWorkspace('local-ws'); });
    await waitFor(() => expect(api.explorerStartWatching).toHaveBeenCalledWith('local-ws'));
    expect(screen.getAllByTestId('workspace-sidebar')).toHaveLength(1);
    expect(document.querySelectorAll('.file-explorer')).toHaveLength(1);
  });
});
