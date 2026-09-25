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
import { installElectronApiMock } from '../../setup/electron';

describe('terminal session bridge', () => {
  beforeEach(() => {
    clearTerminalCache();
    vi.clearAllMocks();
    useAgentAttentionStore.setState({ byTerminalId: {} });
  });

  afterEach(() => {
    clearTerminalCache();
  });

  it('routes terminal output to cached terminals while hidden', () => {
    const write = vi.fn();
    const dispose = vi.fn();
    const terminal = { write, dispose, element: document.createElement('div') } as unknown as {
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
    const terminal = { write, dispose, element: document.createElement('div') } as unknown as {
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
    attention.applyUpdate({ terminalId: 'b', event: 'turn_completed' }, false);
    attention.applyUpdate({ terminalId: 'c', event: 'input_requested' }, false);

    const unsubscribe = startTerminalSessionBridge();
    useWorkspaceStore.getState().selectWorkspace(second.id, 'c');

    expect(useWorkspaceStore.getState().activeTerminalId).toBe('c');
    expect(useAgentAttentionStore.getState().byTerminalId.b.unseen).toBe(true);
    expect(useAgentAttentionStore.getState().byTerminalId.c.unseen).toBe(false);
    unsubscribe();
  });
});
