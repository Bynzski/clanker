import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BrowserPanel from '../../../src/renderer/components/BrowserPanel';
import BrowserLifecycleCoordinator from '../../../src/renderer/components/BrowserLifecycleCoordinator';
import { currentBrowserPresentation, setBrowserPresentation } from '../../../src/renderer/lib/browserPresentation';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';

beforeEach(() => {
  installElectronApiMock();
  setBrowserPresentation(null);
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useAssistantNavStore.setState({ activeAssistantId: null });
  useWorkspaceStore.getState().addWorkspace(createWorkspaceFixture({ id: 'w', panes: [], terminals: [], activeTerminalId: null }));
});
afterEach(() => { setBrowserPresentation(null); });
const store = () => useWorkspaceStore.getState();
const workspace = () => store().getWorkspaceById('w')!;

it('coordinator alone issues fresh pane/tab leases and does not reload existing resources on return', async () => {
  const resources = new Map<string, { pane: string; url: string }>();
  vi.mocked(window.electronAPI.browserGetTabs).mockImplementation(async (_owner, pane) => [...resources].filter(([, value]) => value.pane === pane).map(([tabId, value]) => ({ tabId, url: value.url, title: '' })));
  vi.mocked(window.electronAPI.browserCreateTab).mockImplementation(async (_owner, tab, pane) => { resources.set(tab, { pane: pane!, url: 'https://github.com' }); return { url: 'https://github.com', title: '' }; });
  store().toggleBrowser('w');
  const first = workspace().activePageId!;
  const a = workspace().browserPane!;
  render(<BrowserLifecycleCoordinator activeOwnerId="w" />);
  await waitFor(() => expect(currentBrowserPresentation('w')?.ready).toBe(true));
  const aLease = currentBrowserPresentation('w')!.lease;
  act(() => { store().addWorkspacePage('w'); store().toggleBrowser('w'); });
  const b = workspace().browserPane!;
  await waitFor(() => expect(currentBrowserPresentation('w', b.id)?.ready).toBe(true));
  const bLease = currentBrowserPresentation('w')!.lease;
  expect(bLease.epoch).toBeGreaterThan(aLease.epoch);
  expect(window.electronAPI.browserHide).toHaveBeenCalledWith('w', aLease);
  expect(window.electronAPI.browserCreateTab).toHaveBeenCalledWith('w', b.activeTabId, b.id);
  vi.mocked(window.electronAPI.browserCreateTab).mockClear();
  act(() => store().selectWorkspacePage('w', first));
  await waitFor(() => expect(currentBrowserPresentation('w', a.id)?.ready).toBe(true));
  expect(window.electronAPI.browserCreateTab).not.toHaveBeenCalled();
  expect(window.electronAPI.browserTabNavigate).not.toHaveBeenCalled();
  expect(currentBrowserPresentation('w')!.lease.epoch).toBeGreaterThan(bLease.epoch);
});

it('cancels delayed resource preparation after switching pages, before dispatching create or activate', async () => {
  let finish!: (value: []) => void;
  vi.mocked(window.electronAPI.browserGetTabs).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  store().toggleBrowser('w');
  render(<BrowserLifecycleCoordinator activeOwnerId="w" />);
  act(() => store().addWorkspacePage('w'));
  await act(async () => finish([]));
  expect(window.electronAPI.browserCreateTab).not.toHaveBeenCalled();
  expect(window.electronAPI.browserActivate).not.toHaveBeenCalled();
  expect(currentBrowserPresentation('w')).toBeNull();
});

it('SSH automatic previews initialize once per pane and cannot navigate an existing preview on remount', async () => {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
  store().addWorkspace(createWorkspaceFixture({ id: 'w', environmentId: 'ssh', panes: [], terminals: [], activeTerminalId: null }));
  store().toggleBrowser('w');
  const first = workspace().activePageId!;
  const paneId = workspace().browserPane!.id;
  const service = { remoteHost: '127.0.0.1' as const, remotePort: 5173, protocol: 'http' as const, source: 'listener' as const, processName: 'node', confidence: 'workspace' as const };
  const forward = { workspaceId: 'w', ...service, localPort: 4000, serviceId: 'fixture', status: 'active' as const, url: 'http://127.0.0.1:4000/' };
  vi.mocked(window.electronAPI.remotePreviewWatch).mockResolvedValue({ workspaceId: 'w', forward: null, forwards: [], services: [service] });
  vi.mocked(window.electronAPI.remotePreviewStart).mockResolvedValue({ success: true, forward });
  const mounted = render(<BrowserPanel workspaceId="w" layoutVersion={0} />);
  await waitFor(() => expect(window.electronAPI.browserTabNavigate).toHaveBeenCalledWith('w', expect.any(String), forward.url));
  expect(workspace().browserPane?.remotePreviewInitialized).toBe(true);
  mounted.unmount();
  act(() => { store().selectWorkspace('w'); store().addWorkspacePage('w'); store().toggleBrowser('w'); store().selectWorkspacePage('w', first); });
  expect(workspace().browserPane?.id).toBe(paneId);
  vi.mocked(window.electronAPI.browserTabNavigate).mockClear();
  vi.mocked(window.electronAPI.remotePreviewStart).mockClear();
  render(<BrowserPanel workspaceId="w" layoutVersion={1} />);
  await waitFor(() => expect(window.electronAPI.remotePreviewStart).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  expect(window.electronAPI.browserTabNavigate).not.toHaveBeenCalled();
  expect(workspace().browserUrl).toBe(forward.url);
});

it('overlay hide retires its lease and restoring visibility issues a newer one', async () => {
  store().toggleBrowser('w');
  render(<BrowserLifecycleCoordinator activeOwnerId="w" />);
  await waitFor(() => expect(currentBrowserPresentation('w')?.ready).toBe(true));
  const lease = currentBrowserPresentation('w')!.lease;
  act(() => store().pushBrowserOverlay('w'));
  expect(currentBrowserPresentation('w')).toBeNull();
  expect(window.electronAPI.browserHide).toHaveBeenLastCalledWith('w', lease);
  act(() => store().popBrowserOverlay('w'));
  await waitFor(() => expect(currentBrowserPresentation('w')?.ready).toBe(true));
  expect(currentBrowserPresentation('w')!.lease.epoch).toBeGreaterThan(lease.epoch);
});
