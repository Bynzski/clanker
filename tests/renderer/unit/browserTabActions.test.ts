import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAndActivateBrowserTab } from '../../../src/renderer/lib/browserTabActions';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  installElectronApiMock();
  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-a',
    workspaces: ['ws-a', 'ws-b'].map((id) => createWorkspaceFixture({
      id, lifecycle: 'active', browserVisible: true,
      browserPane: {
        id: `${id}-pane`, position: { x: 0, y: 0, w: 100, h: 100 }, activeTabId: `${id}-1`,
        tabs: [{ id: `${id}-1`, url: 'https://github.com', title: '', canGoBack: false, canGoForward: false }],
      },
    })),
  });
});

describe('asynchronous browser tab creation', () => {
  it('keeps a completed background tab without switching the foreground workspace', async () => {
    const creation = deferred<{ url: string; title: string }>();
    vi.mocked(window.electronAPI.browserCreateTab).mockReturnValue(creation.promise);
    const opening = createAndActivateBrowserTab('ws-a', 'https://a.example/');
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-b' });
    creation.resolve({ url: 'https://github.com', title: '' });
    const tabId = await opening;

    expect(tabId).toBeTruthy();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-b');
    expect(useWorkspaceStore.getState().getWorkspaceById('ws-a')?.browserPane?.tabs.find((tab) => tab.id === tabId)?.url).toBe('https://a.example/');
    expect(window.electronAPI.browserSwitchTab).not.toHaveBeenCalled();
  });

  it('does not undo a newer selection when creation completes', async () => {
    const creation = deferred<{ url: string; title: string }>();
    vi.mocked(window.electronAPI.browserCreateTab).mockReturnValue(creation.promise);
    const opening = createAndActivateBrowserTab('ws-a');
    useWorkspaceStore.getState().setActiveBrowserTab('ws-a-1', 'ws-a');
    creation.resolve({ url: 'https://github.com', title: '' });
    await opening;

    expect(useWorkspaceStore.getState().getWorkspaceById('ws-a')?.browserPane?.activeTabId).toBe('ws-a-1');
    expect(window.electronAPI.browserSwitchTab).not.toHaveBeenCalled();
  });

  it('keeps the newer tab selected when two creations finish in reverse order', async () => {
    const first = deferred<{ url: string; title: string }>();
    const second = deferred<{ url: string; title: string }>();
    vi.mocked(window.electronAPI.browserCreateTab).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const openingFirst = createAndActivateBrowserTab('ws-a', 'https://first.example/');
    const openingSecond = createAndActivateBrowserTab('ws-a', 'https://second.example/');
    second.resolve({ url: 'https://github.com', title: '' });
    const secondId = await openingSecond;
    first.resolve({ url: 'https://github.com', title: '' });
    await openingFirst;

    expect(useWorkspaceStore.getState().getWorkspaceById('ws-a')?.browserPane?.activeTabId).toBe(secondId);
    expect(window.electronAPI.browserSwitchTab).toHaveBeenCalledExactlyOnceWith('ws-a', secondId);
  });

  it('does not navigate or select a tab closed during creation', async () => {
    const creation = deferred<{ url: string; title: string }>();
    vi.mocked(window.electronAPI.browserCreateTab).mockReturnValue(creation.promise);
    const opening = createAndActivateBrowserTab('ws-a', 'https://closed.example/');
    const tabId = useWorkspaceStore.getState().getWorkspaceById('ws-a')!.browserPane!.activeTabId!;
    useWorkspaceStore.getState().removeBrowserTab(tabId, 'ws-a');
    creation.resolve({ url: 'https://github.com', title: '' });

    expect(await opening).toBeNull();
    expect(window.electronAPI.browserTabNavigate).not.toHaveBeenCalled();
    expect(window.electronAPI.browserSwitchTab).not.toHaveBeenCalled();
  });
});
