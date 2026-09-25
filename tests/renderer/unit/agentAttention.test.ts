import { beforeEach, describe, expect, it } from 'vitest';
import { AGENT_NAMES, nameTerminal, nameTerminals } from '../../../src/renderer/lib/agentNames';
import { nextAttentionTarget } from '../../../src/renderer/lib/agentAttentionNavigation';
import { swapPaneIdsInLayout } from '../../../src/renderer/store/workspaceLayout';
import { attentionCounts, useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import type { Terminal, WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';

beforeEach(() => useAgentAttentionStore.setState({ byTerminalId: {} }));

describe('agent pane names and attention', () => {
  it('assigns human names once and avoids collisions after a pane is added', () => {
    const terminals: Terminal[] = [
      { id: 'a', pid: 1, workingDir: '/' },
      { id: 'b', pid: 2, workingDir: '/' },
    ];
    const named = nameTerminals(terminals);
    expect(named.map((terminal) => terminal.displayName)).toEqual(['Samson', 'Delilah']);
    expect(nameTerminal({ id: 'c', pid: 3, workingDir: '/' }, named).displayName).toBe('Jerry');
    expect(nameTerminal(named[0], named)).toBe(named[0]);
    expect(AGENT_NAMES).toContain('Bobby');
    expect(nameTerminals([
      { id: 'd', pid: 4, workingDir: '/' },
      { id: 'e', pid: 5, workingDir: '/', displayName: 'Samson' },
    ]).map((terminal) => terminal.displayName)).toEqual(['Delilah', 'Samson']);
  });

  it('keeps status separate from unseen attention and isolates simultaneous agents', () => {
    const state = useAgentAttentionStore.getState();
    state.applyUpdate({ terminalId: 'a', event: 'turn_started' }, false);
    state.applyUpdate({ terminalId: 'a', event: 'input_requested' }, false);
    state.applyUpdate({ terminalId: 'b', event: 'turn_completed' }, false);
    expect(attentionCounts(['a', 'b'], useAgentAttentionStore.getState().byTerminalId))
      .toEqual({ needsInput: 1, completed: 1 });
    state.acknowledge('a');
    expect(useAgentAttentionStore.getState().byTerminalId.a.lifecycle).toBe('needs_input');
    expect(useAgentAttentionStore.getState().byTerminalId.a.unseen).toBe(false);
    expect(useAgentAttentionStore.getState().byTerminalId.b.unseen).toBe(true);
    state.applyUpdate({ terminalId: 'b', event: 'turn_started' }, false);
    expect(useAgentAttentionStore.getState().byTerminalId.b.unseen).toBe(false);
    state.applyUpdate({ terminalId: 'a', event: 'input_resolved' }, false);
    expect(useAgentAttentionStore.getState().byTerminalId.a.lifecycle).toBe('running');
    state.markExited('b');
    expect(useAgentAttentionStore.getState().byTerminalId.b.lifecycle).toBe('unknown');
  });

  it('jumps to waiting agents before completed turns without clearing other panes', () => {
    const store = useAgentAttentionStore.getState();
    store.applyUpdate({ terminalId: 'a', event: 'turn_completed' }, false);
    store.applyUpdate({ terminalId: 'b', event: 'input_requested' }, false);
    const workspace = { id: 'workspace', terminals: [
      { id: 'a' }, { id: 'b' },
    ], panes: [
      { id: 'pane-a', terminalId: 'a' }, { id: 'pane-b', terminalId: 'b' },
    ] } as WorkspaceTab;
    expect(nextAttentionTarget([workspace], useAgentAttentionStore.getState().byTerminalId, 'a'))
      .toEqual({ workspaceId: 'workspace', terminalId: 'b' });
  });

  it('accepts a completion-only event from a new session in the same terminal', () => {
    const store = useAgentAttentionStore.getState();
    store.applyUpdate({ terminalId: 'a', sessionId: 'old', event: 'turn_completed' }, false);
    store.acknowledge('a');
    store.applyUpdate({ terminalId: 'a', sessionId: 'new', event: 'turn_completed' }, false);
    expect(useAgentAttentionStore.getState().byTerminalId.a).toMatchObject({
      sessionId: 'new', lifecycle: 'turn_complete', unseen: true,
    });
    store.applyUpdate({ terminalId: 'a', sessionId: 'old', event: 'session_ended' }, false);
    expect(useAgentAttentionStore.getState().byTerminalId.a.sessionId).toBe('new');
  });

  it('follows the visible layout after panes are swapped', () => {
    const root = {
      type: 'split' as const, nodeId: 'root', orientation: 'horizontal' as const, ratio: 0.5,
      first: { type: 'leaf' as const, nodeId: 'leaf-a', paneId: 'pane-a' },
      second: {
        type: 'split' as const, nodeId: 'right', orientation: 'vertical' as const, ratio: 0.5,
        first: { type: 'leaf' as const, nodeId: 'leaf-b', paneId: 'pane-b' },
        second: { type: 'leaf' as const, nodeId: 'leaf-c', paneId: 'pane-c' },
      },
    };
    const workspace = {
      id: 'workspace',
      terminals: ['a', 'b', 'c'].map((id) => ({ id })),
      panes: ['a', 'b', 'c'].map((id) => ({ id: `pane-${id}`, terminalId: id })),
      layoutRoot: swapPaneIdsInLayout(root, 'pane-a', 'pane-c'),
    } as WorkspaceTab;
    const store = useAgentAttentionStore.getState();
    for (const terminalId of ['a', 'b', 'c']) {
      store.applyUpdate({ terminalId, event: 'turn_completed' }, false);
    }
    expect(nextAttentionTarget([workspace], useAgentAttentionStore.getState().byTerminalId, 'c'))
      .toEqual({ workspaceId: 'workspace', terminalId: 'b' });
  });
});
