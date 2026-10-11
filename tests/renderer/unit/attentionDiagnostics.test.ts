import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { explainTerminalAttention, installAttentionDiagnostics } from '../../../src/renderer/lib/attentionDiagnostics';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { EMPTY_ATTENTION, snapshot } from '../../_helpers/attentionSnapshots';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import { useCheckoutGitStore } from '../../../src/renderer/store/checkoutGitStore';
import { checkoutSelectionToken } from '../../../src/renderer/lib/checkoutSelectionRuntime';

beforeEach(() => {
  useAgentAttentionStore.setState(EMPTY_ATTENTION);
  useCheckoutGitStore.setState({ active: null });
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws', workspaces: [createWorkspaceFixture({ id: 'ws', terminals: [{ id: 't', pid: 1, workingDir: '/PRIVATE', harnessId: 'codex', attentionEnabled: true }], panes: [{ id: 'p', terminalId: 't' }], layoutRoot: { type: 'leaf', nodeId: 'l', paneId: 'p' } })] });
});
afterEach(() => { delete window.clankerAttention; });
function mainAt(revision: number) {
  return { main: { terminalId: 't', harness: 'codex', transport: 'local', signal: { requested: true, attachment: 'prepared', health: 'observed' }, revision, status: 'idle', received: 2, verdicts: {}, hooks: {} }, terminal: { harness: 'codex', workspaceId: 'ws', environmentId: 'local', attention: { requested: true, attachment: 'prepared' } } };
}

describe('query-only end-to-end attention diagnostics', () => {
  it('distinguishes renderer lag, current acknowledged idle and a local tombstone', async () => {
    installElectronApiMock({ getAgentAttentionDiagnostics: vi.fn().mockResolvedValue(mainAt(6)) });
    const completed = snapshot('t', 'completed', 6);
    useAgentAttentionStore.getState().applyChange({ terminalId: 't', revision: 5, snapshot: { ...completed, revision: 5 } }, false);
    expect(await explainTerminalAttention('t')).toMatchObject({ renderer: { comparison: 'renderer-behind', revision: 5 } });
    useAgentAttentionStore.getState().applyChange({ terminalId: 't', revision: 6, snapshot: completed }, false);
    useAgentAttentionStore.getState().acknowledge('t');
    const explained = await explainTerminalAttention('t');
    expect(explained).toMatchObject({ renderer: { comparison: 'current', indicator: null, suppressed: 'acknowledged-idle' } });
    expect(JSON.stringify(explained)).not.toMatch(/PRIVATE|workingDir|cwd|sessionId|turnId/);
    useAgentAttentionStore.getState().retire('t');
    expect(await explainTerminalAttention('t')).toMatchObject({ renderer: { tombstone: true, snapshotPresent: false } });
  });

  it('distinguishes unavailable acquisition from no displayable native evidence', async () => {
    installElectronApiMock({ getAgentAttentionDiagnostics: vi.fn().mockResolvedValue(mainAt(4)) });
    const unverified = snapshot('t', 'idle', 4);
    unverified.signal = { requested: true, attachment: 'unavailable', health: 'unverified', reason: 'configuration-conflict' };
    useAgentAttentionStore.getState().hydrate([unverified], () => false);
    expect(await explainTerminalAttention('t')).toMatchObject({ renderer: { indicator: 'signal_unavailable', signal: { reason: 'configuration-conflict' } } });
  });

  it('traces selected versus queried terminal, authenticated provenance and matching Git state without native session IDs', async () => {
    installElectronApiMock({ getAgentAttentionDiagnostics: vi.fn().mockResolvedValue(mainAt(4)) });
    const context = { id: 'ws::task', workspaceId: 'ws', environmentId: 'local', kind: 'worktree' as const, path: '/task', branch: 'test1' };
    const workspace = { ...useWorkspaceStore.getState().workspaces[0], checkoutContexts: [context], activeTerminalId: 'pi', terminals: [{ id: 't', pid: 1, workingDir: '/PRIVATE', harnessId: 'opencode', checkoutContextId: 'ws::main' }, { id: 'pi', pid: 2, workingDir: '/task', harnessId: 'pi', checkoutContextId: context.id }] };
    useWorkspaceStore.setState({ workspaces: [workspace], activeTerminalId: 'pi' });
    useAgentAttentionStore.getState().hydrate([snapshot('pi', 'running', 4, { location: { path: '/task', checkoutContextId: context.id }, locationProvenance: { state: 'current', sessionId: 'PRIVATE_NATIVE_SESSION' } })], () => false);
    const generation = useCheckoutGitStore.getState().begin({ workspaceId: 'ws', environmentId: 'local', contextId: context.id, root: '/task', selectionGeneration: checkoutSelectionToken('ws') });
    const explained = await explainTerminalAttention('t');
    expect(explained).toMatchObject({ renderer: { checkoutPresentation: { workspaceActiveTerminalId: 'pi', globalActiveTerminalId: 'pi', queriedTerminalLaunchContextId: 'ws::main', selectedLocationProvenance: 'current', selection: { source: 'observed', root: '/task' }, git: { availability: 'loading', matchesSelection: true, generation } } } });
    expect(JSON.stringify(explained)).not.toContain('PRIVATE_NATIVE_SESSION');
    useCheckoutGitStore.getState().invalidate(generation);
    expect(await explainTerminalAttention('t')).toMatchObject({ renderer: { checkoutPresentation: { selection: { availability: 'available', root: '/task' }, git: { availability: 'unavailable' } } } });
  });

  it('installs a developer console query only when main enables debugging, and cleans it up', async () => {
    const api = installElectronApiMock();
    const off = installAttentionDiagnostics();
    await Promise.resolve();
    expect(window.clankerAttention).toBeUndefined();
    off();
    api.isAttentionDebugEnabled.mockResolvedValue(true);
    const on = installAttentionDiagnostics();
    await Promise.resolve();
    expect(window.clankerAttention?.explain).toBe(explainTerminalAttention);
    on();
    expect(window.clankerAttention).toBeUndefined();
    const pending = installAttentionDiagnostics();
    pending();
    await Promise.resolve();
    expect(window.clankerAttention).toBeUndefined();
  });

  it('returns no diagnostic when the main debug gate refuses the query', async () => {
    installElectronApiMock();
    expect(await explainTerminalAttention('t')).toBeNull();
  });
});
