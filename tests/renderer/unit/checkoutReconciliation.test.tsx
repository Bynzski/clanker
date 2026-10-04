// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { requestCheckoutReconciliation, useCheckoutReconciliation } from '../../../src/renderer/lib/checkoutReconciliation';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { installElectronApiMock } from '../../setup/electron';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';
import { EMPTY_ATTENTION, snapshot, storeState } from '../../_helpers/attentionSnapshots';
import { mainCheckoutContextId } from '../../../src/shared/checkoutContext';
import type { CheckoutContext, ReconcileCheckoutContextsResult } from '../../../src/shared/types/checkoutContext';

const MAIN: CheckoutContext = { id: mainCheckoutContextId('ws'), workspaceId: 'ws', environmentId: 'local', path: '/w/app', kind: 'main' };
const GONE: CheckoutContext = { id: 'ws::ckt-gone', workspaceId: 'ws', environmentId: 'local', path: '/w/app-worktrees/gone', kind: 'worktree', branch: 'gone' };

function open(overrides: Parameters<typeof createWorkspaceFixture>[0] = {}) {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, activeWorkspaceLifecycle: null, terminals: [], panes: [], activeTerminalId: null });
  const { id: _id, lifecycle: _lifecycle, ...input } = createWorkspaceFixture({
    workspacePath: '/w/app',
    checkoutContexts: [MAIN, GONE],
    terminals: [
      createTerminalFixture({ id: 't-wt', harnessId: 'claude', checkoutContextId: GONE.id }),
      createTerminalFixture({ id: 't-main', harnessId: 'codex', checkoutContextId: MAIN.id }),
    ],
    ...overrides,
  });
  void _id; void _lifecycle;
  useWorkspaceStore.getState().addWorkspace({ ...input, id: 'ws' });
}
const reconcileMock = () => window.electronAPI.reconcileCheckoutContexts as unknown as ReturnType<typeof vi.fn>;
const contexts = () => useWorkspaceStore.getState().getWorkspaceById('ws')?.checkoutContexts;

describe('checkout reconciliation requests', () => {
  beforeEach(() => {
    installElectronApiMock();
    useAgentAttentionStore.setState(EMPTY_ATTENTION);
  });
  afterEach(() => cleanup());

  it('applies main\'s result to the workspace', async () => {
    open();
    reconcileMock().mockResolvedValue({ success: true, contexts: [{ ...GONE, missing: true }], dropped: [] } satisfies ReconcileCheckoutContextsResult);
    await requestCheckoutReconciliation('ws');
    expect(reconcileMock()).toHaveBeenCalledWith('ws');
    expect(contexts()).toEqual([MAIN, { ...GONE, branch: 'gone', missing: true }]);
  });

  it('asks main nothing for a workspace without worktree checkouts', async () => {
    open({ checkoutContexts: [MAIN] });
    await requestCheckoutReconciliation('ws');
    expect(reconcileMock()).not.toHaveBeenCalled();
  });

  it('coalesces requests while one is running into a single follow-up', async () => {
    open();
    let finish!: (value: ReconcileCheckoutContextsResult) => void;
    reconcileMock().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = requestCheckoutReconciliation('ws');
    void requestCheckoutReconciliation('ws');
    void requestCheckoutReconciliation('ws');
    expect(reconcileMock()).toHaveBeenCalledTimes(1);
    finish({ success: true, contexts: [], dropped: [] });
    await first;
    await waitFor(() => expect(reconcileMock()).toHaveBeenCalledTimes(2));
  });

  it('survives a failed request', async () => {
    open();
    reconcileMock().mockRejectedValueOnce(new Error('ipc down'));
    await expect(requestCheckoutReconciliation('ws')).resolves.toBeUndefined();
    expect(contexts()).toEqual([MAIN, GONE]);
  });
});

describe('when reconciliation runs', () => {
  beforeEach(() => {
    installElectronApiMock();
    useAgentAttentionStore.setState(EMPTY_ATTENTION);
    open();
    useWorkspaceStore.getState().selectWorkspace('ws');
  });
  afterEach(() => cleanup());

  it('on window focus, for the active workspace', async () => {
    renderHook(() => useCheckoutReconciliation());
    reconcileMock().mockClear();
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(reconcileMock()).toHaveBeenCalledWith('ws'));
  });

  it('when an agent\'s turn ends, and when its agent exits', async () => {
    useAgentAttentionStore.setState(storeState([snapshot('t-wt', 'running', 1)]));
    renderHook(() => useCheckoutReconciliation());
    reconcileMock().mockClear();

    act(() => useAgentAttentionStore.getState().applyChange({ terminalId: 't-wt', revision: 2, snapshot: snapshot('t-wt', 'completed', 2) }, false));
    await waitFor(() => expect(reconcileMock()).toHaveBeenCalledTimes(1));
    act(() => useAgentAttentionStore.getState().applyChange({ terminalId: 't-wt', revision: 3, snapshot: null }, false));
    await waitFor(() => expect(reconcileMock()).toHaveBeenCalledTimes(2));
  });

  it('not for activity that ends no turn', async () => {
    useAgentAttentionStore.setState(storeState([snapshot('t-wt', 'running', 1)]));
    renderHook(() => useCheckoutReconciliation());
    reconcileMock().mockClear();
    act(() => useAgentAttentionStore.getState().applyChange({ terminalId: 't-wt', revision: 2, snapshot: snapshot('t-wt', 'needs_input', 2) }, false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reconcileMock()).not.toHaveBeenCalled();
  });

  it('when a terminal of the workspace closes', async () => {
    renderHook(() => useCheckoutReconciliation());
    reconcileMock().mockClear();
    act(() => useWorkspaceStore.getState().removeTerminal('t-wt'));
    await waitFor(() => expect(reconcileMock()).toHaveBeenCalledWith('ws'));
  });
});
