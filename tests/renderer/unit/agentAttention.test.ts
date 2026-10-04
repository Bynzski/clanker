import { beforeEach, describe, expect, it } from 'vitest';
import { AGENT_NAMES, nameTerminal, nameTerminals } from '../../../src/renderer/lib/agentNames';
import { nextAttentionTarget } from '../../../src/renderer/lib/agentAttentionNavigation';
import { swapPaneIdsInLayout } from '../../../src/renderer/store/workspaceLayout';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { EMPTY_ATTENTION, snapshot, storeState } from '../../_helpers/attentionSnapshots';
import type { Terminal, WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';

beforeEach(() => useAgentAttentionStore.setState(EMPTY_ATTENTION));

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

  it('jumps to waiting agents before completed turns without clearing other panes', () => {
    useAgentAttentionStore.setState(storeState([snapshot('a', 'completed', 3), snapshot('b', 'needs_input', 4)]));
    const { byTerminalId, seenByTerminalId } = useAgentAttentionStore.getState();
    const workspace = { id: 'workspace', terminals: [
      { id: 'a' }, { id: 'b' },
    ], panes: [
      { id: 'pane-a', terminalId: 'a' }, { id: 'pane-b', terminalId: 'b' },
    ] } as WorkspaceTab;
    expect(nextAttentionTarget([workspace], byTerminalId, seenByTerminalId, 'a'))
      .toEqual({ workspaceId: 'workspace', terminalId: 'b' });
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
    useAgentAttentionStore.setState(storeState(['a', 'b', 'c'].map((id) => snapshot(id, 'completed', 2))));
    const { byTerminalId, seenByTerminalId } = useAgentAttentionStore.getState();
    expect(nextAttentionTarget([workspace], byTerminalId, seenByTerminalId, 'c'))
      .toEqual({ workspaceId: 'workspace', terminalId: 'b' });
  });
});
