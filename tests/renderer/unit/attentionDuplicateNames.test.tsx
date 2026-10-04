// @vitest-environment jsdom

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attentionCounts, useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { nextAttentionTarget } from '../../../src/renderer/lib/agentAttentionNavigation';
import { deriveAttention } from '../../../src/renderer/lib/agentAttentionPresentation';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import { createTerminalFixture, createWorkspaceFixture } from '../../setup/fixtures';
import { change, EMPTY_ATTENTION, snapshot } from '../../_helpers/attentionSnapshots';

/** Human-readable agent names are presentation only: two terminals may share one. */
describe('attention identity with duplicate display names', () => {
  const store = () => useAgentAttentionStore.getState();
  beforeEach(() => {
    installElectronApiMock();
    useAgentAttentionStore.setState(EMPTY_ATTENTION);
    const a = createWorkspaceFixture({
      id: 'ws-a', name: 'alpha', workspacePath: '/p/a', lifecycle: 'active',
      terminals: [createTerminalFixture({ id: 'term-a', displayName: 'Samson', harnessId: 'codex', attentionEnabled: true })],
      panes: [{ id: 'pa', terminalId: 'term-a' }], activeTerminalId: 'term-a',
    });
    const b = createWorkspaceFixture({
      id: 'ws-b', name: 'beta', workspacePath: '/p/b', lifecycle: 'parked',
      terminals: [createTerminalFixture({ id: 'term-b', displayName: 'Samson', harnessId: 'codex', attentionEnabled: true })],
      panes: [{ id: 'pb', terminalId: 'term-b' }], activeTerminalId: 'term-b',
    });
    useWorkspaceStore.setState({ workspaces: [a, b], activeWorkspaceId: 'ws-a', activeTerminalId: 'term-a' });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('keeps lookup, counts, acknowledgement and navigation isolated by terminal and workspace id', () => {
    store().applyChange(change(snapshot('term-a', 'running', 3)), false);
    store().applyChange(change(snapshot('term-b', 'completed', 4)), false);
    const { workspaces } = useWorkspaceStore.getState();
    const ids = (workspaceId: string) => workspaces.find((w) => w.id === workspaceId)!.terminals.map((t) => t.id);

    const state = store();
    expect(deriveAttention(state.byTerminalId['term-a'], state.seenByTerminalId['term-a'])?.display).toBe('running');
    expect(deriveAttention(state.byTerminalId['term-b'], state.seenByTerminalId['term-b'])?.display).toBe('turn_complete');
    expect(attentionCounts(ids('ws-a'), state.byTerminalId, state.seenByTerminalId)).toEqual({ needsInput: 0, completed: 0 });
    expect(attentionCounts(ids('ws-b'), state.byTerminalId, state.seenByTerminalId)).toEqual({ needsInput: 0, completed: 1 });
    expect(nextAttentionTarget(workspaces, state.byTerminalId, state.seenByTerminalId, 'term-a'))
      .toEqual({ workspaceId: 'ws-b', terminalId: 'term-b' });

    // Acknowledging one Samson never touches the other.
    store().acknowledge('term-a');
    expect(store().seenByTerminalId['term-a']).toBeUndefined();
    store().acknowledge('term-b');
    const after = store();
    expect(attentionCounts(ids('ws-b'), after.byTerminalId, after.seenByTerminalId)).toEqual({ needsInput: 0, completed: 0 });
    expect(deriveAttention(after.byTerminalId['term-a'], after.seenByTerminalId['term-a'])?.display).toBe('running');
  });
});
