import { beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_NAMES, RECENT_NAME_LIMIT, nameTerminal, nameTerminals, pickAgentName, resetRecentAgentNames,
} from '../../../src/renderer/lib/agentNames';
import { nextAttentionTarget } from '../../../src/renderer/lib/agentAttentionNavigation';
import { swapPaneIdsInLayout } from '../../../src/renderer/store/workspaceLayout';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { EMPTY_ATTENTION, snapshot, storeState } from '../../_helpers/attentionSnapshots';
import type { Terminal, WorkspaceTab } from '../../../src/renderer/store/workspaceTypes';

beforeEach(() => {
  useAgentAttentionStore.setState(EMPTY_ATTENTION);
  resetRecentAgentNames();
});

describe('agent pane names and attention', () => {
  const first = () => 0;
  const last = () => 0.999999;
  const term = (id: string, displayName?: string): Terminal => ({ id, pid: 1, workingDir: '/', displayName });

  it('has a large pool of distinct names', () => {
    expect(AGENT_NAMES.length).toBeGreaterThanOrEqual(80);
    expect(new Set(AGENT_NAMES).size).toBe(AGENT_NAMES.length);
  });

  it('picks by injected randomness and never repeats a name within a workspace', () => {
    expect(pickAgentName(new Set(), [], first)).toBe(AGENT_NAMES[0]);
    expect(pickAgentName(new Set(), [], last)).toBe(AGENT_NAMES[AGENT_NAMES.length - 1]);
    expect(pickAgentName(new Set([AGENT_NAMES[0]]), [], first)).toBe(AGENT_NAMES[1]);

    const named = nameTerminals(AGENT_NAMES.map((_, index) => term(`t${index}`)), last, []);
    expect(new Set(named.map((terminal) => terminal.displayName)).size).toBe(AGENT_NAMES.length);
  });

  it('avoids recently assigned names across workspaces until nothing else is left', () => {
    const recent = AGENT_NAMES.slice(0, RECENT_NAME_LIMIT);
    expect(pickAgentName(new Set(), recent, first)).toBe(AGENT_NAMES[RECENT_NAME_LIMIT]);
    const allButRecent = new Set<string | undefined>(AGENT_NAMES.slice(RECENT_NAME_LIMIT));
    expect(pickAgentName(allButRecent, recent, first)).toBe(AGENT_NAMES[0]);
  });

  it('adds a numeric suffix only after every base name is used', () => {
    const used = new Set<string | undefined>(AGENT_NAMES);
    expect(pickAgentName(used, [], first)).toBe(`${AGENT_NAMES[0]} 2`);
    expect(pickAgentName(new Set(AGENT_NAMES.slice(1)), [], first)).toBe(AGENT_NAMES[0]);
  });

  it('keeps assigned names, records history for new ones, and bounds that history', () => {
    const existing = term('a', 'Samson');
    expect(nameTerminal(existing, [existing], first, [])).toBe(existing);

    const recent: string[] = [];
    for (let index = 0; index < RECENT_NAME_LIMIT + 3; index++) {
      nameTerminal(term(`n${index}`), [], first, recent);
    }
    expect(recent).toHaveLength(RECENT_NAME_LIMIT);

    const named = nameTerminals([term('d'), term('e', 'Samson')], first, []);
    expect(named.map((terminal) => terminal.displayName)).toEqual(['Delilah', 'Samson']);
    expect(named[1].id).toBe('e');
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
