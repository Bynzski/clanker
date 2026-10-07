// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installElectronApiMock } from '../../setup/electron';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAssistantNavStore } from '../../../src/renderer/store/assistantNavStore';
import { devDependencyInstallCommand, installDevServiceDependencies } from '../../../src/renderer/lib/devServiceInstall';
import type { DevServiceCommand } from '../../../src/shared/types/workspaceServices';
import type { CheckoutContext } from '../../../src/shared/types/checkoutContext';

const context: CheckoutContext = { id: 'ws::wt', workspaceId: 'ws', environmentId: 'local', kind: 'worktree', path: '/repo-worktrees/task', branch: 'task' };
const command: DevServiceCommand = { workspaceId: 'ws', checkoutContextId: context.id, checkoutRoot: context.path, cwd: context.path, command: 'npm run dev', packageManager: 'npm' };
function setup() {
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws', workspaces: [createWorkspaceFixture({ id: 'ws', workspacePath: '/repo', checkoutContexts: [context], terminals: [createTerminalFixture({ id: 'agent', checkoutContextId: context.id })] })] });
  useAssistantNavStore.getState().clearAllAssistants();
  installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true, command }), spawnTerminal: vi.fn().mockResolvedValue({ id: 'install', pid: 42, checkoutContextId: context.id }) });
}

describe('explicit dev dependency setup', () => {
  beforeEach(setup);
  it.each(['npm', 'pnpm', 'yarn', 'bun'] as const)('uses only the fixed %s install command', (manager) => {
    expect(devDependencyInstallCommand(manager)).toBe(`${manager} install`);
  });
  it('opens a visible, tracked shell in the isolated checkout rather than the main workspace; no dev-server auto-start', async () => {
    await installDevServiceDependencies('agent', command);
    expect(window.electronAPI.workspaceServiceDiscover).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'ws', terminalId: 'agent' });
    expect(window.electronAPI.spawnTerminal).toHaveBeenCalledExactlyOnceWith(context.path, undefined, undefined, 'npm install', undefined, 'ws', 'local', context.id);
    const workspace = useWorkspaceStore.getState().getWorkspaceById('ws')!;
    expect(workspace.terminals.find((entry) => entry.id === 'install')).toMatchObject({ displayName: 'Install dependencies', checkoutContextId: context.id, workingDir: context.path });
    expect(workspace.panes.some((pane) => pane.terminalId === 'install')).toBe(true);
    expect(workspace.activeTerminalId).toBe('install');
    expect(window.electronAPI.workspaceServiceStart).not.toHaveBeenCalled();
    expect(window.electronAPI.writeTerminal).not.toHaveBeenCalled(); // Existing ready handshake owns command delivery.
  });
  it('passes the confirmed canonical cwd for a symlinked context, still bound to its context id', async () => {
    const physical = { ...command, cwd: '/physical/task' };
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true, command: physical }), spawnTerminal: vi.fn().mockResolvedValue({ id: 'install', pid: 42, checkoutContextId: context.id }) });
    await installDevServiceDependencies('agent', physical);
    expect(window.electronAPI.spawnTerminal).toHaveBeenCalledWith(physical.cwd, undefined, undefined, 'npm install', undefined, 'ws', 'local', context.id);
  });
  it.each([
    { checkoutContextId: 'other' }, { cwd: '/different' }, { checkoutRoot: '/escape' }, { packageManager: 'pnpm' }, { command: 'npm run something-else' },
  ])('refuses a changed authoritative confirmation %j', async (change) => {
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true, command: { ...command, ...change } }) });
    await expect(installDevServiceDependencies('agent', command)).rejects.toThrow('changed');
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
  });
  it('refuses a closed workspace/context and SSH before opening any shell', async () => {
    const workspace = useWorkspaceStore.getState().workspaces[0];
    useWorkspaceStore.setState({ workspaces: [{ ...workspace, environmentId: 'ssh' }] });
    await expect(installDevServiceDependencies('agent', command)).rejects.toThrow('no longer available');
    useWorkspaceStore.setState({ workspaces: [{ ...workspace, checkoutContexts: [] }] });
    await expect(installDevServiceDependencies('agent', command)).rejects.toThrow('no longer available');
    useWorkspaceStore.setState({ workspaces: [] });
    await expect(installDevServiceDependencies('agent', command)).rejects.toThrow('no longer available');
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
  });
  it('refuses a late discovery after context removal or a newer Assistant selection', async () => {
    let finish!: (value: { success: boolean; command: DevServiceCommand }) => void;
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; })) });
    const installing = installDevServiceDependencies('agent', command);
    useAssistantNavStore.getState().openAssistantSurface('assistant');
    finish({ success: true, command });
    await expect(installing).rejects.toThrow('selection changed');
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
  });
  it('refuses a discovery reply after the checkout was removed', async () => {
    let finish!: (value: { success: boolean; command: DevServiceCommand }) => void;
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; })) });
    const installing = installDevServiceDependencies('agent', command);
    const workspace = useWorkspaceStore.getState().workspaces[0];
    useWorkspaceStore.setState({ workspaces: [{ ...workspace, checkoutContexts: [] }] });
    finish({ success: true, command });
    await expect(installing).rejects.toThrow('no longer available');
    expect(window.electronAPI.spawnTerminal).not.toHaveBeenCalled();
  });
  it('kills a shell that main binds incorrectly instead of leaving an untracked install process', async () => {
    installElectronApiMock({ workspaceServiceDiscover: vi.fn().mockResolvedValue({ success: true, command }), spawnTerminal: vi.fn().mockResolvedValue({ id: 'install', pid: 42, checkoutContextId: 'wrong' }) });
    await expect(installDevServiceDependencies('agent', command)).rejects.toThrow('requested checkout');
    expect(window.electronAPI.killTerminal).toHaveBeenCalledWith('install');
    expect(useWorkspaceStore.getState().workspaces[0].terminals).toHaveLength(1);
  });
});
