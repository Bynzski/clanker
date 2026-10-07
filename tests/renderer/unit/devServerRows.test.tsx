// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WorkspaceNavigatorSection from '../../../src/renderer/components/WorkspaceNavigatorSection';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useWorkspaceServiceStore, startWorkspaceServiceBridge } from '../../../src/renderer/store/workspaceServiceStore';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { installElectronApiMock } from '../../setup/electron';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';
import type { DevServiceCommand, WorkspaceService, WorkspaceServicesUpdate } from '../../../src/shared/types/workspaceServices';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';
import { snapshot } from '../../_helpers/attentionSnapshots';

const main: CheckoutContext = { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: '/repo', kind: 'main' };
const wt: CheckoutContext = { id: 'ws::wt', workspaceId: 'ws', environmentId: 'local', path: '/repo-worktrees/feature', kind: 'worktree', branch: 'feature' };
const command: DevServiceCommand = { workspaceId: 'ws', checkoutContextId: wt.id, checkoutRoot: wt.path, cwd: wt.path, command: 'npm run dev', packageManager: 'npm' };
const service: WorkspaceService = { ...command, id: 'service', sourceTerminalId: 'agent', status: 'running', previewUrl: 'http://localhost:5173/' };
function setup() {
  useWorkspaceStore.setState({ workspaces: [createWorkspaceFixture({ id: 'ws', workspacePath: '/repo', checkoutContexts: [main, wt], terminals: [createTerminalFixture({ id: 'agent', displayName: 'Sam', harnessId: 'codex', checkoutContextId: wt.id })], activeTerminalId: 'agent' })], activeWorkspaceId: 'ws' });
  useWorkspaceServiceStore.setState({ revision: -1, services: [] });
  useAgentAttentionStore.setState({ byTerminalId: {}, revisionByTerminalId: {}, seenByTerminalId: {} });
  useAssistantNavStore.getState().clearAllAssistants();
  return installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true, command }) });
}

describe('checkout-aware sidebar service controls', () => {
  beforeEach(setup);
  afterEach(cleanup);
  it('renders discovery beneath the two-line agent without executing anything; Run sends only identity and the displayed command', async () => {
    render(<WorkspaceNavigatorSection />);
    const run = await screen.findByRole('button', { name: 'Run Dev Server · npm run dev' });
    expect(window.electronAPI.workspaceServiceStart).not.toHaveBeenCalled();
    expect(run.closest('li')?.querySelector('.ws-agent-name')?.textContent).toBe('Sam');
    const agent = screen.getByRole('button', { name: /Sam.*Codex/ });
    expect(agent.querySelector('.ws-agent-primary .ws-agent-branch')).toBeNull();
    expect(agent.querySelector('.ws-agent-branch')).toBeTruthy();
    expect(agent.classList.contains('current')).toBe(true);
    expect(run.title).toContain(wt.path);
    fireEvent.click(run);
    await waitFor(() => expect(window.electronAPI.workspaceServiceStart).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'ws', terminalId: 'agent', checkoutContextId: wt.id, cwd: wt.path, command: 'npm run dev' }));
  });
  it('shows running status and stops only this service', async () => {
    useWorkspaceServiceStore.setState({ services: [service] });
    render(<WorkspaceNavigatorSection />);
    expect(screen.getByText('Dev Server · localhost:5173')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop Dev Server' }));
    await waitFor(() => expect(window.electronAPI.workspaceServiceStop).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'ws', serviceId: 'service' }));
    expect(window.electronAPI.killTerminal).not.toHaveBeenCalled();
  });
  it('keeps services accessible after the source terminal closes and identifies the orphan service checkout', async () => {
    useWorkspaceServiceStore.setState({ services: [service] });
    const workspace = useWorkspaceStore.getState().workspaces[0];
    useWorkspaceStore.setState({ workspaces: [{ ...workspace, terminals: [] }] });
    render(<WorkspaceNavigatorSection />);
    const detached = screen.getByLabelText('Checkout service');
    expect(within(detached).getByText('feature')).toBeTruthy();
    expect(within(detached).getByRole('button', { name: 'Stop Dev Server' })).toBeTruthy();
  });
  it.each(['stopped', 'failed'] as const)('does not leave an orphan %s service row after the originating conversation closes', (status) => {
    useWorkspaceServiceStore.setState({ services: [{ ...service, status, previewUrl: undefined }] });
    const workspace = useWorkspaceStore.getState().workspaces[0];
    useWorkspaceStore.setState({ workspaces: [{ ...workspace, terminals: [] }] });
    render(<WorkspaceNavigatorSection />);
    expect(screen.queryByLabelText('Checkout service')).toBeNull();
    expect(screen.queryByText(/Dev Server/)).toBeNull();
  });
  it('shows an installation advisory and expandable failure diagnostics without running an install', async () => {
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true, command: { ...command, preparationHint: 'Run npm install in this checkout first.' } }) });
    const { rerender } = render(<WorkspaceNavigatorSection />);
    expect(await screen.findByText('Run npm install in this checkout first.')).toBeTruthy();
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
    expect(window.electronAPI.workspaceServiceStart).not.toHaveBeenCalled();
    act(() => useWorkspaceServiceStore.setState({ services: [{ ...service, status: 'failed', error: 'sh: next: command not found', previewUrl: undefined }] }));
    rerender(<WorkspaceNavigatorSection />);
    expect(screen.getByText('Why it failed').closest('details')?.textContent).toContain('sh: next: command not found');
  });
  it('shows startup/failure and start errors without consuming any layout pane', async () => {
    useWorkspaceServiceStore.setState({ services: [{ ...service, status: 'starting', previewUrl: undefined }] });
    const { rerender } = render(<WorkspaceNavigatorSection />);
    expect(screen.getByText('Dev Server · starting')).toBeTruthy();
    act(() => useWorkspaceServiceStore.setState({ services: [{ ...service, status: 'failed', previewUrl: undefined, exitCode: 1 }] }));
    rerender(<WorkspaceNavigatorSection />);
    expect(screen.getByText('Dev Server · exited (1)')).toBeTruthy();
    await screen.findByRole('button', { name: /Run Dev Server/ });
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true, command }), workspaceServiceStart: vi.fn().mockResolvedValue({ success: false, error: 'Checkout changed' }) });
    fireEvent.click(screen.getByRole('button', { name: /Run Dev Server/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Checkout changed');
    expect(useWorkspaceStore.getState().workspaces[0].panes).toHaveLength(1);
  });
  it('keeps service ownership correct when the agent reports moving to another checkout', async () => {
    useWorkspaceServiceStore.setState({ services: [service] });
    const mainCommand = { ...command, checkoutContextId: main.id, checkoutRoot: main.path, cwd: main.path };
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true, command: mainCommand }) });
    useAgentAttentionStore.setState({ byTerminalId: { agent: snapshot('agent', 'idle', 1, { location: { path: main.path, checkoutContextId: main.id } }) } });
    render(<WorkspaceNavigatorSection />);
    await screen.findByRole('button', { name: /Run Dev Server/ });
    expect(screen.getByLabelText('Checkout service')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Stop Dev Server' })).toHaveLength(1);
  });
  it('does not discover or offer local Run on SSH workspaces', () => {
    const workspace = useWorkspaceStore.getState().workspaces[0];
    useWorkspaceStore.setState({ workspaces: [{ ...workspace, environmentId: 'ssh' }] });
    render(<WorkspaceNavigatorSection />);
    expect(window.electronAPI.workspaceServiceDiscover).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Run Dev Server/ })).toBeNull();
    expect(screen.getByRole('note').textContent).toBe('Dev Server · local only');
    expect(screen.getByRole('note').title).toContain('remote terminal');
  });
  it('shows no service row where no dev script exists; reports discovery errors with an accessible retry', async () => {
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true }) });
    const { unmount } = render(<WorkspaceNavigatorSection />);
    await waitFor(() => expect(window.electronAPI.workspaceServiceDiscover).toHaveBeenCalled());
    expect(screen.queryByText(/Dev Server/)).toBeNull(); unmount();
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: false, error: 'Invalid package.json' }) });
    render(<WorkspaceNavigatorSection />);
    const retry = await screen.findByRole('button', { name: 'Retry dev command discovery' });
    expect(retry.title).toBe('Invalid package.json');
    fireEvent.click(retry);
    await waitFor(() => expect(window.electronAPI.workspaceServiceDiscover).toHaveBeenCalledTimes(2));
  });
  it('opens the owning workspace Browser only after a fresh probe and never spawns a visible terminal', async () => {
    useWorkspaceServiceStore.setState({ services: [service] });
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true, command }), probeRecipePreview: vi.fn().mockResolvedValue({ status: 'ready' }), browserTabNavigate: vi.fn().mockResolvedValue(true) });
    render(<WorkspaceNavigatorSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Dev Server in Browser' }));
    await waitFor(() => expect(window.electronAPI.browserTabNavigate).toHaveBeenCalledWith('ws', expect.any(String), service.previewUrl));
    expect(useWorkspaceStore.getState().workspaces[0].browserVisible).toBe(true);
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
  });
  it('does not navigate on failed readiness', async () => {
    useWorkspaceServiceStore.setState({ services: [service] });
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true, command }), probeRecipePreview: vi.fn().mockResolvedValue({ status: 'unavailable' }) });
    render(<WorkspaceNavigatorSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Dev Server in Browser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not reachable');
    expect(window.electronAPI.browserCreateTab).not.toHaveBeenCalled();
  });
  it('does not redirect Browser after the user switches workspace/Assistant during a readiness probe', async () => {
    useWorkspaceServiceStore.setState({ services: [service] });
    let finish!: (value: { status: 'ready' }) => void;
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true, command }), probeRecipePreview: vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; })) });
    render(<WorkspaceNavigatorSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Dev Server in Browser' }));
    act(() => useAssistantNavStore.getState().openAssistantSurface('assistant'));
    await act(async () => { finish({ status: 'ready' }); });
    expect(window.electronAPI.browserCreateTab).not.toHaveBeenCalled();
  });
});

describe('app-scoped service bridge', () => {
  beforeEach(setup);
  afterEach(cleanup);
  it('keeps background updates, ignores out-of-order hydration, and disposes listeners', async () => {
    let notify!: (update: WorkspaceServicesUpdate) => void;
    let hydrate!: (update: WorkspaceServicesUpdate) => void;
    const unsubscribe = vi.fn();
    installElectronApiMock({ onWorkspaceServicesChanged: vi.fn((callback) => { notify = callback; return unsubscribe; }), workspaceServiceGet: vi.fn().mockReturnValue(new Promise((resolve) => { hydrate = resolve; })) });
    const dispose = startWorkspaceServiceBridge();
    notify({ revision: 2, services: [service] });
    hydrate({ revision: 1, services: [{ ...service, status: 'starting' }] });
    await Promise.resolve();
    expect(useWorkspaceServiceStore.getState().services[0].status).toBe('running');
    useWorkspaceStore.setState({ activeWorkspaceId: 'other' });
    notify({ revision: 3, services: [{ ...service, status: 'failed', exitCode: 1 }] });
    expect(useWorkspaceServiceStore.getState().services[0].status).toBe('failed');
    dispose(); expect(unsubscribe).toHaveBeenCalledOnce();
    notify({ revision: 4, services: [] });
    expect(useWorkspaceServiceStore.getState().services).toHaveLength(1);
  });
  it('removes ended orphan/context records immediately on store changes and refuses their late snapshots', () => {
    useWorkspaceServiceStore.getState().apply({ revision: 1, services: [{ ...service, status: 'stopped' }] });
    const dispose = startWorkspaceServiceBridge();
    const workspace = useWorkspaceStore.getState().workspaces[0];
    useWorkspaceStore.setState({ workspaces: [{ ...workspace, terminals: [] }] });
    expect(useWorkspaceServiceStore.getState().services).toEqual([]);
    useWorkspaceServiceStore.getState().apply({ revision: 2, services: [{ ...service, status: 'stopped' }] });
    expect(useWorkspaceServiceStore.getState().services).toEqual([]);
    useWorkspaceServiceStore.getState().apply({ revision: 3, services: [service] });
    expect(useWorkspaceServiceStore.getState().services).toHaveLength(1);
    useWorkspaceStore.setState({ workspaces: [{ ...workspace, checkoutContexts: [main] }] });
    expect(useWorkspaceServiceStore.getState().services).toEqual([]);
    dispose();
  });
  it('drops closed workspace entries and refuses snapshots for foreign or repointed contexts', () => {
    useWorkspaceServiceStore.getState().apply({ revision: 1, services: [service, { ...service, id: 'wrong', checkoutRoot: '/escape' }, { ...service, id: 'foreign', workspaceId: 'other' }] });
    expect(useWorkspaceServiceStore.getState().services).toEqual([service]);
    const dispose = startWorkspaceServiceBridge();
    useWorkspaceStore.setState({ workspaces: [] });
    expect(useWorkspaceServiceStore.getState().services).toEqual([]);
    dispose();
  });
});
