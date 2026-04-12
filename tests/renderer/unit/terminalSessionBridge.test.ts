import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cacheTerminalInstance,
  clearTerminalCache,
  markTerminalDisposed,
  writeCachedTerminalData,
  writeCachedTerminalExit,
} from '../../../src/renderer/components/TerminalPane';
import { startTerminalSessionBridge } from '../../../src/renderer/lib/terminalSessionBridge';

describe('terminal session bridge', () => {
  beforeEach(() => {
    clearTerminalCache();
    vi.clearAllMocks();
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
});
