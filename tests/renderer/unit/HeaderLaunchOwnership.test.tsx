// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Header from '../../setup/HeaderWithSettings';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { useWorkspaceNavigationStore } from '../../../src/renderer/store/workspaceNavigationStore';
import { collectLeafPaneIds } from '../../../src/renderer/store/workspaceLayout';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';

vi.mock('../../../src/renderer/components/GitButton', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/IsolatedAgentButton', () => ({ default: () => null }));
const store = () => useWorkspaceStore.getState();
const owner = () => store().getWorkspaceById('owned')!;
let finish: (info: Awaited<ReturnType<typeof window.electronAPI.spawnTerminal>>) => void;

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useAssistantNavStore.setState({ activeAssistantId: null });
  useWorkspaceNavigationStore.setState({ mode: 'tabs' });
  installElectronApiMock({
    getHarnessOptions: vi.fn().mockResolvedValue({ codex: true }),
    getEnvironmentHarnessOptions: vi.fn().mockResolvedValue({ codex: true }),
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(window.electronAPI.spawnTerminal).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function begin(environmentId = 'local', button = 'Terminal') {
  store().addWorkspace(createWorkspaceFixture({ id: 'owned', workspacePath: '/workspace', environmentId, terminals: [], panes: [] }));
  render(<Header />);
  fireEvent.click(await screen.findByRole('button', { name: button }));
  expect(window.electronAPI.spawnTerminal).toHaveBeenCalledTimes(1);
  expect(owner().panes).toHaveLength(1);
  expect(owner().panes[0].terminalId).toBeNull();
  return { pageId: owner().activePageId!, paneId: owner().panes[0].id };
}
async function complete() { await act(async () => finish({ id: 'spawned', pid: 42 })); }

describe('toolbar launch ownership', () => {
  for (const environmentId of ['local', 'ssh-slow']) for (const button of ['Terminal', 'Codex']) {
    it(`${environmentId} ${button}: attaches to the initiating page, not the selected page after spawn`, async () => {
      const { pageId, paneId } = await begin(environmentId, button);
      act(() => { store().addWorkspacePage('owned'); });
      const selected = owner().activePageId;
      expect(selected).not.toBe(pageId);
      act(() => { store().removeWorkspacePage('owned', pageId); });
      expect(owner().pages).toHaveLength(2);
      await complete();
      await waitFor(() => expect(owner().terminals).toHaveLength(1));
      expect(owner().activePageId).toBe(selected);
      expect(owner().layoutRoot).toBeNull();
      expect(collectLeafPaneIds(owner().pages!.find((page) => page.id === pageId)!.layoutRoot)).toEqual([paneId]);
      expect(owner().panes[0].terminalId).toBe('spawned');
      expect(window.electronAPI.killTerminal).not.toHaveBeenCalled();
    });
    it(`${environmentId} ${button}: terminates a late spawn after workspace closure`, async () => {
      await begin(environmentId, button);
      act(() => { store().closeWorkspace('owned'); });
      await complete();
      await waitFor(() => expect(window.electronAPI.killTerminal).toHaveBeenCalledWith('spawned'));
      expect(store().workspaces.flatMap((workspace) => workspace.terminals)).toEqual([]);
      expect(window.electronAPI.releaseCheckoutContext).not.toHaveBeenCalled();
    });
  }
  it('terminates a returned process when addTerminal silently declines registration', async () => {
    await begin();
    const register = vi.fn();
    act(() => { useWorkspaceStore.setState({ addTerminal: register }); });
    await complete();
    await waitFor(() => expect(window.electronAPI.killTerminal).toHaveBeenCalledWith('spawned'));
    expect(register).toHaveBeenCalled();
    expect(owner().terminals).toEqual([]);
    expect(owner().panes).toEqual([]);
  });
  it('rejects a main-reported checkout binding other than the requested implicit main context', async () => {
    await begin();
    await act(async () => finish({ id: 'spawned', pid: 42, checkoutContextId: 'another-workspace::main' }));
    await waitFor(() => expect(window.electronAPI.killTerminal).toHaveBeenCalledWith('spawned'));
    expect(owner().terminals).toEqual([]);
    expect(owner().panes).toEqual([]);
  });
  it('does not attach a pending launch to a replacement workspace with the same id', async () => {
    await begin();
    act(() => {
      store().closeWorkspace('owned');
      store().addWorkspace(createWorkspaceFixture({ id: 'owned', workspacePath: '/workspace', terminals: [], panes: [] }));
    });
    await complete();
    await waitFor(() => expect(window.electronAPI.killTerminal).toHaveBeenCalledWith('spawned'));
    expect(owner().terminals).toEqual([]);
    expect(owner().panes).toEqual([]);
  });
  it('cleans a failed spawn reservation on its original page without switching selection', async () => {
    const failure = new Error('SSH failed');
    let reject!: (error: Error) => void;
    vi.mocked(window.electronAPI.spawnTerminal).mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const { pageId } = await begin('ssh-slow');
    act(() => { store().addWorkspacePage('owned'); });
    const selected = owner().activePageId;
    await act(async () => reject(failure));
    await waitFor(() => expect(owner().panes).toEqual([]));
    expect(owner().activePageId).toBe(selected);
    expect(owner().pages!.find((page) => page.id === pageId)!.layoutRoot).toBeNull();
    expect(window.electronAPI.killTerminal).not.toHaveBeenCalled();
  });
});
