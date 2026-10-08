// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DevServerRow from '../../../src/renderer/components/DevServerRow';
import { startWorkspaceServiceBridge, useWorkspaceServiceStore } from '../../../src/renderer/store/workspaceServiceStore';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';
import { installElectronApiMock } from '../../setup/electron';
import type { DevServiceCommand, DevServiceDiscoveryResult, DevServiceTarget, WorkspaceServicesUpdate } from '../../../src/shared/types/workspaceServices';

const root = '/repo-worktrees/shared';
const initialRevision = 'a'.repeat(64), savedRevision = 'b'.repeat(64), defaultRevision = '0'.repeat(64);
const command: DevServiceCommand = { workspaceId: 'ws', checkoutContextId: 'ws::shared', checkoutRoot: root, cwd: root, command: 'npm run dev', packageManager: 'npm', settingsRevision: initialRevision };
const terminals = ['one', 'two', 'unrelated'].map((id) => createTerminalFixture({ id, harnessId: 'codex', checkoutContextId: id === 'unrelated' ? 'ws::main' : 'ws::shared' }));
const workspace = createWorkspaceFixture({ id: 'ws', workspacePath: '/repo', terminals, checkoutContexts: [
  { id: 'ws::main', workspaceId: 'ws', environmentId: 'local', path: '/repo', kind: 'main' },
  { id: 'ws::shared', workspaceId: 'ws', environmentId: 'local', path: root, kind: 'worktree' },
] });
function snapshot(revision: number, fingerprint: string): WorkspaceServicesUpdate {
  return { revision, services: [], settings: { defaultRevision, checkouts: fingerprint === defaultRevision ? [] : [{ cwd: root, settingsRevision: fingerprint }] } };
}
let dispose: (() => void) | undefined;
beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: 'ws' });
  useAgentAttentionStore.setState({ byTerminalId: {}, revisionByTerminalId: {}, seenByTerminalId: {} });
  useWorkspaceServiceStore.setState({ revision: -1, services: [], settings: undefined });
});
afterEach(() => { cleanup(); dispose?.(); dispose = undefined; });
function setup(withAlias = false) {
  const aliasTerminal = createTerminalFixture({ id: 'alias-agent', harnessId: 'codex', checkoutContextId: 'alias::main' });
  const alias = createWorkspaceFixture({ id: 'alias', workspacePath: root, terminals: [aliasTerminal], checkoutContexts: [
    { id: 'alias::main', workspaceId: 'alias', environmentId: 'local', path: root, kind: 'main' },
  ] });
  if (withAlias) useWorkspaceStore.setState({ workspaces: [workspace, alias] });
  let storedRevision = initialRevision;
  let notify!: (update: WorkspaceServicesUpdate) => void;
  let hydrate!: (update: WorkspaceServicesUpdate) => void;
  const api = installElectronApiMock({
    onWorkspaceServicesChanged: vi.fn((callback) => { notify = callback; return vi.fn(); }),
    workspaceServiceGet: vi.fn().mockReturnValue(new Promise((resolve) => { hydrate = resolve; })),
    workspaceServiceDiscover: vi.fn(async ({ terminalId, workspaceId }: DevServiceTarget): Promise<DevServiceDiscoveryResult> => ({ success: true,
      command: workspaceId === 'alias' ? { ...command, workspaceId, checkoutContextId: 'alias::main', settingsRevision: storedRevision } : terminalId === 'unrelated' ? { ...command, checkoutContextId: 'ws::main', checkoutRoot: '/repo', cwd: '/repo', settingsRevision: defaultRevision }
        : { ...command, settingsRevision: storedRevision }, environment: { PORT: '8788' } })),
  });
  dispose = startWorkspaceServiceBridge();
  useWorkspaceServiceStore.getState().apply(snapshot(1, initialRevision));
  render(<>{terminals.map((terminal) => <section key={terminal.id} aria-label={terminal.id}><DevServerRow workspace={workspace} terminal={terminal} /></section>)}
    {withAlias && <section aria-label="alias"><DevServerRow workspace={alias} terminal={aliasTerminal} /></section>}</>);
  return { api, hydrate, publish: (revision: number, fingerprint: string) => { storedRevision = fingerprint; notify(snapshot(revision, fingerprint)); } };
}
describe('shared-checkout configuration invalidation', () => {
  it('refreshes all matching rows after Save, without starting anything or rediscovering an unrelated checkout', async () => {
    const { api, publish, hydrate } = setup(true);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Run Dev Server/ })).toHaveLength(4));
    // Wait until the initial root lookup has settled before measuring invalidation.
    await act(async () => {});
    const countUnrelated = api.workspaceServiceDiscover.mock.calls.filter(([request]) => request.terminalId === 'unrelated').length;
    api.workspaceServiceSaveSettings.mockImplementation(async () => { publish(2, savedRevision); return { success: true, command: { ...command, settingsRevision: savedRevision } }; });
    fireEvent.click(within(screen.getByRole('region', { name: 'one' })).getByRole('button', { name: 'Configure Dev Server' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('value', 'PORT=8788'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'PORT=8789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => { hydrate(snapshot(0, initialRevision)); });
    expect(useWorkspaceServiceStore.getState().settings?.checkouts[0].settingsRevision).toBe(savedRevision);
    expect(api.workspaceServiceStart).not.toHaveBeenCalled();
    expect(api.workspaceServiceDiscover.mock.calls.filter(([request]) => request.terminalId === 'unrelated')).toHaveLength(countUnrelated);
    for (const name of ['one', 'two', 'alias']) {
      fireEvent.click(within(screen.getByRole('region', { name })).getByRole('button', { name: /Run Dev Server/ }));
      await waitFor(() => expect(api.workspaceServiceStart).toHaveBeenCalledWith(expect.objectContaining({ terminalId: name === 'alias' ? 'alias-agent' : name, settingsRevision: savedRevision })));
    }
  });
  it('disables Run until invalidated discovery completes and never automatically retries a failed launch', async () => {
    const { api, publish } = setup();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Run Dev Server/ })).toHaveLength(3));
    await act(async () => {});
    let resolve!: (value: DevServiceDiscoveryResult) => void;
    const original = api.workspaceServiceDiscover.getMockImplementation()! as (request: DevServiceTarget) => Promise<DevServiceDiscoveryResult>;
    api.workspaceServiceDiscover.mockImplementation((request) => request.terminalId === 'two' ? new Promise((finish) => { resolve = finish; }) : original(request));
    act(() => publish(2, savedRevision));
    const run = within(screen.getByRole('region', { name: 'two' })).getByRole('button', { name: /Run Dev Server/ });
    expect(run).toHaveProperty('disabled', true);
    fireEvent.click(run);
    expect(api.workspaceServiceStart).not.toHaveBeenCalled();
    await act(async () => { resolve({ success: true, command: { ...command, settingsRevision: savedRevision } }); });
    expect(run).toHaveProperty('disabled', false);
    api.workspaceServiceStart.mockResolvedValue({ success: false, error: 'Settings changed; discover again' });
    fireEvent.click(run);
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings changed');
    await act(async () => { publish(3, defaultRevision); resolve({ success: true, command: { ...command, settingsRevision: defaultRevision } }); });
    expect(api.workspaceServiceStart).toHaveBeenCalledTimes(1);
  });
  it('handles clearing settings and cumulative snapshots across reordered notifications', async () => {
    const { api, publish } = setup();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Run Dev Server/ })).toHaveLength(3));
    await act(async () => {});
    act(() => publish(3, savedRevision));
    await act(async () => {});
    act(() => publish(4, defaultRevision));
    await act(async () => {});
    act(() => useWorkspaceServiceStore.getState().apply(snapshot(2, initialRevision)));
    const run = within(screen.getByRole('region', { name: 'two' })).getByRole('button', { name: /Run Dev Server/ });
    await waitFor(() => expect(run).toHaveProperty('disabled', false));
    fireEvent.click(run);
    await waitFor(() => expect(api.workspaceServiceStart).toHaveBeenCalledWith(expect.objectContaining({ terminalId: 'two', settingsRevision: defaultRevision })));
  });
});
