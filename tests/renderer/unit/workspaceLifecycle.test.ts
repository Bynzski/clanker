import { describe, it, expect, vi } from 'vitest';
import { terminateWorkspaceTerminals } from '../../../src/renderer/lib/workspaceLifecycle';
import { createWorkspaceFixture, createTerminalFixture } from '../../setup/fixtures';

describe('terminateWorkspaceTerminals', () => {
  it('calls killTerminal for each terminal in the workspace', async () => {
    const killMock = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('window', {
      electronAPI: { killTerminal: killMock },
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
  });

  it('continues killing terminals even if one fails', async () => {
    const killMock = vi.fn()
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('kill failed'))
      .mockResolvedValueOnce({ success: true });
    vi.stubGlobal('window', {
      electronAPI: { killTerminal: killMock },
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
    expect(consoleSpy).toHaveBeenCalledWith('Failed to kill terminal:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('does nothing when workspace has no terminals', async () => {
    const killMock = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('window', {
      electronAPI: { killTerminal: killMock },
    });

    const ws = createWorkspaceFixture({ terminals: [] });
    await terminateWorkspaceTerminals(ws);
    expect(killMock).not.toHaveBeenCalled();
  });
});
