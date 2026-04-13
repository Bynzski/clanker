import { describe, it, expect, vi } from 'vitest';
import { disposeWorkspaceResources, terminateWorkspaceTerminals } from '../../../src/renderer/lib/workspaceLifecycle';
import { createWorkspaceFixture, createTerminalFixture } from '../../setup/fixtures';

describe('terminateWorkspaceTerminals', () => {
  it('calls killTerminal for each terminal in the workspace', async () => {
    const killMock = vi.fn().mockResolvedValue({ success: true });
    const cleanupMock = vi.fn().mockResolvedValue(3);
    vi.stubGlobal('window', {
      electronAPI: { killTerminal: killMock, cleanupWorkspaceTerminals: cleanupMock },
    });

    const ws = createWorkspaceFixture({
      terminals: [
        createTerminalFixture({ id: 't1' }),
        createTerminalFixture({ id: 't2' }),
        createTerminalFixture({ id: 't3' }),
      ],
    });

    await terminateWorkspaceTerminals(ws);

    expect(killMock).toHaveBeenCalledTimes(3);
    expect(killMock).toHaveBeenCalledWith('t1');
    expect(killMock).toHaveBeenCalledWith('t2');
    expect(killMock).toHaveBeenCalledWith('t3');
    expect(cleanupMock).toHaveBeenCalledWith(['t1', 't2', 't3']);
  });

  it('continues killing terminals even if one fails', async () => {
    const killMock = vi.fn()
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('kill failed'))
      .mockResolvedValueOnce({ success: true });
    const cleanupMock = vi.fn().mockResolvedValue(3);
    vi.stubGlobal('window', {
      electronAPI: { killTerminal: killMock, cleanupWorkspaceTerminals: cleanupMock },
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ws = createWorkspaceFixture({
      terminals: [
        createTerminalFixture({ id: 't1' }),
        createTerminalFixture({ id: 't2' }),
        createTerminalFixture({ id: 't3' }),
      ],
    });

    await terminateWorkspaceTerminals(ws);

    expect(killMock).toHaveBeenCalledTimes(3);
    expect(cleanupMock).toHaveBeenCalledWith(['t1', 't2', 't3']);
    expect(consoleSpy).toHaveBeenCalledWith('Failed to kill terminal:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('does nothing when workspace has no terminals', async () => {
    const killMock = vi.fn().mockResolvedValue({ success: true });
    const cleanupMock = vi.fn().mockResolvedValue(0);
    vi.stubGlobal('window', {
      electronAPI: { killTerminal: killMock, cleanupWorkspaceTerminals: cleanupMock },
    });

    const ws = createWorkspaceFixture({ terminals: [] });
    await terminateWorkspaceTerminals(ws);
    expect(killMock).not.toHaveBeenCalled();
    expect(cleanupMock).not.toHaveBeenCalled();
  });
});

describe('disposeWorkspaceResources', () => {
  it('stops the active explorer watcher and disposes the browser workspace', async () => {
    const explorerStopWatching = vi.fn().mockResolvedValue(undefined);
    const browserDisposeWorkspace = vi.fn().mockResolvedValue(undefined);
    const killTerminal = vi.fn().mockResolvedValue({ success: true });
    const cleanupWorkspaceTerminals = vi.fn().mockResolvedValue(1);

    vi.stubGlobal('window', {
      electronAPI: {
        explorerStopWatching,
        browserDisposeWorkspace,
        killTerminal,
        cleanupWorkspaceTerminals,
      },
    });

    const workspace = createWorkspaceFixture({
      id: 'ws-1',
      terminals: [createTerminalFixture({ id: 't1' })],
    });

    await disposeWorkspaceResources(workspace, { isActiveWorkspace: true });

    expect(explorerStopWatching).toHaveBeenCalledTimes(1);
    expect(killTerminal).toHaveBeenCalledWith('t1');
    expect(browserDisposeWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('does not stop explorer watching for a parked workspace and falls back to browserHide', async () => {
    const explorerStopWatching = vi.fn().mockResolvedValue(undefined);
    const browserDisposeWorkspace = vi.fn().mockRejectedValue(new Error('dispose failed'));
    const browserHide = vi.fn().mockResolvedValue(undefined);
    const killTerminal = vi.fn().mockResolvedValue({ success: true });
    const cleanupWorkspaceTerminals = vi.fn().mockResolvedValue(0);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubGlobal('window', {
      electronAPI: {
        explorerStopWatching,
        browserDisposeWorkspace,
        browserHide,
        killTerminal,
        cleanupWorkspaceTerminals,
      },
    });

    const workspace = createWorkspaceFixture({ id: 'ws-2', terminals: [] });

    await disposeWorkspaceResources(workspace, { isActiveWorkspace: false });

    expect(explorerStopWatching).not.toHaveBeenCalled();
    expect(browserDisposeWorkspace).toHaveBeenCalledWith('ws-2');
    expect(browserHide).toHaveBeenCalledWith('ws-2');
    expect(consoleSpy).toHaveBeenCalledWith('Failed to dispose browser workspace:', expect.any(Error));

    consoleSpy.mockRestore();
  });
});
