import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cacheTerminalInstance,
  clearTerminalCache,
  markTerminalDisposed,
  writeCachedTerminalData,
  writeCachedTerminalExit,
} from '../../../src/renderer/components/TerminalPane';
import { startTerminalSessionBridge } from '../../../src/renderer/lib/terminalSessionBridge';
import { useAgentAttentionStore } from '../../../src/renderer/store/agentAttentionStore';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { createWorkspaceFixture } from '../../setup/fixtures';
import { change, EMPTY_ATTENTION, snapshot, tombstone } from '../../_helpers/attentionSnapshots';
import { deriveAttention } from '../../../src/renderer/lib/agentAttentionPresentation';
import type { AgentAttentionChange, AgentAttentionSnapshot } from '../../../src/shared/types/agentAttention';
import { installElectronApiMock } from '../../setup/electron';

describe('terminal session bridge', () => {
  beforeEach(() => {
    clearTerminalCache();
    vi.clearAllMocks();
    useAgentAttentionStore.setState(EMPTY_ATTENTION);
  });

  afterEach(() => {
    clearTerminalCache();
  });

  it('routes terminal output to cached terminals while hidden', () => {
    const write = vi.fn();
    const dispose = vi.fn();
    const terminal = { write, dispose, options: {}, element: document.createElement('div') } as unknown as {
      write: (data: string) => void;
      dispose: () => void;
      element: HTMLDivElement;
    };
    const fitAddon = {} as unknown as { fit: () => void; proposeDimensions: () => { cols: number; rows: number } | null };

    cacheTerminalInstance('term-1', terminal as never, fitAddon as never);

    const dataCallbackHolder: { current?: (payload: { id: string; data: string }) => void } = {};
    const exitCallbackHolder: { current?: (payload: { id: string; exitCode: number }) => void } = {};
    const disposeData = vi.fn();
    const disposeExit = vi.fn();

    window.electronAPI = {
      ...window.electronAPI,
      onTerminalData: (callback: (payload: { id: string; data: string }) => void) => {
        dataCallbackHolder.current = callback;
        return disposeData;
      },
      onTerminalExit: (callback: (payload: { id: string; exitCode: number }) => void) => {
        exitCallbackHolder.current = callback;
        return disposeExit;
      },
    };

    const unsubscribe = startTerminalSessionBridge();

    dataCallbackHolder.current?.({ id: 'term-1', data: 'hello' });
    exitCallbackHolder.current?.({ id: 'term-1', exitCode: 0 });

    expect(write).toHaveBeenCalledWith('hello');
    expect(write).toHaveBeenCalledWith('\r\n\x1b[33mProcess exited with code 0\x1b[0m\r\n');

    unsubscribe();
    expect(disposeData).toHaveBeenCalled();
    expect(disposeExit).toHaveBeenCalled();
  });

  it('prevents explicitly disposed terminals from being re-cached', () => {
    const write = vi.fn();
    const dispose = vi.fn();
    const terminal = { write, dispose, options: {}, element: document.createElement('div') } as unknown as {
      write: (data: string) => void;
      dispose: () => void;
      element: HTMLDivElement;
    };
    const fitAddon = {} as unknown as { fit: () => void; proposeDimensions: () => { cols: number; rows: number } | null };

    markTerminalDisposed('term-closed');
    cacheTerminalInstance('term-closed', terminal as never, fitAddon as never);

    expect(dispose).toHaveBeenCalled();
    expect(writeCachedTerminalData('term-closed', 'ignored')).toBe(false);
    expect(writeCachedTerminalExit('term-closed', 1)).toBe(false);
  });

  it('acknowledges only the target pane when jumping into another workspace', () => {
    installElectronApiMock();
    const first = createWorkspaceFixture({
      id: 'ws-first',
      terminals: [{ id: 'a', pid: 1, workingDir: '/' }],
      panes: [{ id: 'pane-a', terminalId: 'a' }],
      activeTerminalId: 'a',
      layoutRoot: { type: 'leaf', nodeId: 'leaf-a', paneId: 'pane-a' },
    });
    const second = createWorkspaceFixture({
      id: 'ws-second', lifecycle: 'parked',
      terminals: [{ id: 'b', pid: 2, workingDir: '/' }, { id: 'c', pid: 3, workingDir: '/' }],
      panes: [{ id: 'pane-b', terminalId: 'b' }, { id: 'pane-c', terminalId: 'c' }],
      activeTerminalId: 'b',
      layoutRoot: {
        type: 'split', nodeId: 'split', orientation: 'horizontal', ratio: 0.5,
        first: { type: 'leaf', nodeId: 'leaf-b', paneId: 'pane-b' },
        second: { type: 'leaf', nodeId: 'leaf-c', paneId: 'pane-c' },
      },
    });
    useWorkspaceStore.setState({
      workspaces: [first, second], activeWorkspaceId: first.id,
      activeTerminalId: 'a', terminals: first.terminals, panes: first.panes,
      layoutRoot: first.layoutRoot,
    });
    const attention = useAgentAttentionStore.getState();
    attention.applyChange(change(snapshot('b', 'completed', 2)), false);
    attention.applyChange(change(snapshot('c', 'needs_input', 3)), false);
    const before = useAgentAttentionStore.getState().byTerminalId;

    const unsubscribe = startTerminalSessionBridge();
    useWorkspaceStore.getState().selectWorkspace(second.id, 'c');

    const after = useAgentAttentionStore.getState();
    expect(useWorkspaceStore.getState().activeTerminalId).toBe('c');
    expect(deriveAttention(after.byTerminalId.b, after.seenByTerminalId.b)?.unseen).toBe(true);
    expect(deriveAttention(after.byTerminalId.c, after.seenByTerminalId.c)?.unseen).toBe(false);
    // Switching workspaces only acknowledges; it never mutates the canonical lifecycle.
    expect(after.byTerminalId).toBe(before);
    unsubscribe();
  });

  describe('attention snapshot recovery', () => {
    function attentionApi(hydration: () => Promise<AgentAttentionSnapshot[]>) {
      const order: string[] = [];
      const listener: { current?: (change: AgentAttentionChange) => void } = {};
      const dispose = vi.fn();
      const api = installElectronApiMock({
        onAgentAttentionChanged: vi.fn((callback: (change: AgentAttentionChange) => void) => {
          order.push('subscribe');
          listener.current = callback;
          return dispose;
        }),
        getAgentAttentionSnapshots: vi.fn(() => { order.push('hydrate'); return hydration(); }),
      } as never);
      return { api, order, listener, dispose };
    }
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const view = (id: string) => {
      const state = useAgentAttentionStore.getState();
      return deriveAttention(state.byTerminalId[id], state.seenByTerminalId[id]);
    };

    it('subscribes before it hydrates, and hydration restores running and waiting agents', async () => {
      const { order } = attentionApi(async () => [snapshot('a', 'running', 4), snapshot('b', 'needs_input', 5)]);
      const stop = startTerminalSessionBridge();
      expect(order).toEqual(['subscribe', 'hydrate']);
      await flush();
      expect(view('a')?.display).toBe('running');
      expect(view('b')?.display).toBe('needs_input');
      stop();
    });

    it('a push that lands before hydration returns is not regressed by the older hydrated snapshot', async () => {
      let resolve!: (value: AgentAttentionSnapshot[]) => void;
      const { listener } = attentionApi(() => new Promise((done) => { resolve = done; }));
      const stop = startTerminalSessionBridge();
      listener.current?.(change(snapshot('a', 'completed', 12)));
      resolve([snapshot('a', 'running', 11)]);
      await flush();
      expect(useAgentAttentionStore.getState().byTerminalId.a.revision).toBe(12);
      expect(view('a')?.display).toBe('turn_complete');
      stop();
    });

    it('a tombstone for an exited agent blocks a stale hydration and a late push', async () => {
      let resolve!: (value: AgentAttentionSnapshot[]) => void;
      const { listener } = attentionApi(() => new Promise((done) => { resolve = done; }));
      const stop = startTerminalSessionBridge();
      listener.current?.(tombstone('a', 7));
      resolve([snapshot('a', 'running', 6)]);
      listener.current?.(change(snapshot('a', 'needs_input', 6)));
      await flush();
      expect(useAgentAttentionStore.getState().byTerminalId.a).toBeUndefined();
      stop();
    });

    it('survives unmount and remount: the next hydration restores the lifecycle', async () => {
      const live = [snapshot('a', 'needs_input', 4)];
      attentionApi(async () => live);
      const first = startTerminalSessionBridge();
      await flush();
      first();
      useAgentAttentionStore.setState(EMPTY_ATTENTION); // renderer state recreated
      const second = startTerminalSessionBridge();
      await flush();
      expect(view('a')?.display).toBe('needs_input');
      second();
    });

    it('removes a cached agent that retired in main while the bridge was away', async () => {
      useAgentAttentionStore.getState().applyChange(change(snapshot('a', 'running', 4)), false);
      attentionApi(async () => []);
      const stop = startTerminalSessionBridge();
      await flush();
      expect(useAgentAttentionStore.getState().byTerminalId.a).toBeUndefined();
      stop();
    });

    it('a push during hydration survives a response that omits or predates it', async () => {
      useAgentAttentionStore.getState().applyChange(change(snapshot('a', 'running', 4)), false);
      let resolve!: (value: AgentAttentionSnapshot[]) => void;
      const { listener } = attentionApi(() => new Promise((done) => { resolve = done; }));
      const stop = startTerminalSessionBridge();
      listener.current?.(change(snapshot('a', 'needs_input', 5)));
      listener.current?.(change(snapshot('fresh', 'running', 2)));
      resolve([]);
      await flush();
      expect(useAgentAttentionStore.getState().byTerminalId.a.revision).toBe(5);
      expect(useAgentAttentionStore.getState().byTerminalId.fresh.revision).toBe(2);
      stop();
    });

    it('a tombstone during hydration survives a response captured before it', async () => {
      useAgentAttentionStore.getState().applyChange(change(snapshot('a', 'running', 4)), false);
      let resolve!: (value: AgentAttentionSnapshot[]) => void;
      const { listener } = attentionApi(() => new Promise((done) => { resolve = done; }));
      const stop = startTerminalSessionBridge();
      listener.current?.(tombstone('a', 5));
      resolve([snapshot('a', 'running', 4)]);
      await flush();
      expect(useAgentAttentionStore.getState().byTerminalId.a).toBeUndefined();
      stop();
    });

    it('does not apply a hydration that resolves after the bridge was disposed', async () => {
      let resolve!: (value: AgentAttentionSnapshot[]) => void;
      attentionApi(() => new Promise((done) => { resolve = done; }));
      startTerminalSessionBridge()();
      resolve([snapshot('a', 'running', 4)]);
      await flush();
      expect(useAgentAttentionStore.getState().byTerminalId.a).toBeUndefined();
    });

    it('retires attention when the terminal process exits', async () => {
      const exit: { current?: (payload: { id: string; exitCode: number }) => void } = {};
      attentionApi(async () => [snapshot('a', 'running', 4)]);
      window.electronAPI = { ...window.electronAPI, onTerminalExit: (cb: never) => { exit.current = cb; return () => undefined; } } as never;
      const stop = startTerminalSessionBridge();
      await flush();
      exit.current?.({ id: 'a', exitCode: 0 });
      expect(useAgentAttentionStore.getState().byTerminalId.a).toBeUndefined();
      stop();
    });

    it('acknowledges a hydrated completion for the already-foreground pane only', async () => {
      const first = createWorkspaceFixture({
        id: 'ws', terminals: [{ id: 'a', pid: 1, workingDir: '/' }, { id: 'b', pid: 2, workingDir: '/' }],
        panes: [{ id: 'pane-a', terminalId: 'a' }, { id: 'pane-b', terminalId: 'b' }], activeTerminalId: 'a',
        layoutRoot: { type: 'split', nodeId: 's', orientation: 'horizontal', ratio: 0.5, first: { type: 'leaf', nodeId: 'la', paneId: 'pane-a' }, second: { type: 'leaf', nodeId: 'lb', paneId: 'pane-b' } },
      });
      useWorkspaceStore.setState({ workspaces: [first], activeWorkspaceId: first.id, activeTerminalId: 'a', terminals: first.terminals, panes: first.panes, layoutRoot: first.layoutRoot });
      attentionApi(async () => [snapshot('a', 'completed', 4), snapshot('b', 'completed', 4)]);
      const stop = startTerminalSessionBridge();
      await flush();
      expect(view('a')).toBeNull();
      expect(view('b')?.display).toBe('turn_complete');
      stop();
    });
  });
});
