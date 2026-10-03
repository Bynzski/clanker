// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExplorerLifecycleCoordinator from '../../../src/renderer/components/ExplorerLifecycleCoordinator';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

const flush = () => act(async () => { await Promise.resolve(); });

describe('ExplorerLifecycleCoordinator (rendered without WorkspaceTabs)', () => {
  let api: ReturnType<typeof installElectronApiMock>;

  beforeEach(() => {
    api = installElectronApiMock();
    useWorkspaceStore.setState({
      workspaces: [
        createWorkspaceFixture({ id: 'local-a', workspacePath: '/a', environmentId: 'local' }),
        createWorkspaceFixture({ id: 'local-b', workspacePath: '/b' }),
        createWorkspaceFixture({ id: 'remote', workspacePath: '/a', environmentId: 'vps' }),
      ],
      activeWorkspaceId: 'local-a',
    });
  });

  afterEach(cleanup);

  it('starts watching the active local workspace on mount', () => {
    render(<ExplorerLifecycleCoordinator />);
    expect(api.explorerStartWatching).toHaveBeenCalledWith('local-a');
  });

  it('follows local → local switches', async () => {
    render(<ExplorerLifecycleCoordinator />);
    api.explorerStartWatching.mockClear();
    useWorkspaceStore.setState({ activeWorkspaceId: 'local-b' });
    await flush();
    expect(api.explorerStartWatching).toHaveBeenCalledWith('local-b');
  });

  it('stops the local watcher for SSH and restarts it when returning to local', async () => {
    render(<ExplorerLifecycleCoordinator />);
    api.explorerStartWatching.mockClear();
    api.explorerStopWatching.mockClear();

    useWorkspaceStore.setState({ activeWorkspaceId: 'remote' });
    await flush();
    expect(api.explorerStopWatching).toHaveBeenCalled();
    expect(api.explorerStartWatching).not.toHaveBeenCalled();

    useWorkspaceStore.setState({ activeWorkspaceId: 'local-a' });
    await flush();
    expect(api.explorerStartWatching).toHaveBeenCalledWith('local-a');
  });

  it('stops watching when there is no active workspace', async () => {
    render(<ExplorerLifecycleCoordinator />);
    api.explorerStopWatching.mockClear();
    useWorkspaceStore.setState({ activeWorkspaceId: null });
    await flush();
    expect(api.explorerStopWatching).toHaveBeenCalledTimes(1);
  });

  it('stops watching on unmount and ignores later switches', async () => {
    const { unmount } = render(<ExplorerLifecycleCoordinator />);
    api.explorerStopWatching.mockClear();
    api.explorerStartWatching.mockClear();
    unmount();
    expect(api.explorerStopWatching).toHaveBeenCalledTimes(1);

    useWorkspaceStore.setState({ activeWorkspaceId: 'local-b' });
    await flush();
    expect(api.explorerStartWatching).not.toHaveBeenCalled();
  });
});
