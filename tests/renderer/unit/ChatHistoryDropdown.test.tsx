// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatHistoryDropdown from '../../../src/renderer/components/ChatHistoryDropdown';
import { useWorkspaceStore } from '../../../src/renderer/store/workspaceStore';
import { installElectronApiMock } from '../../setup/electron';
import type { TaskSessionRecord } from '../../../src/shared/types/taskSessions';
import type { HarnessSession } from '../../../src/shared/types/session';

describe('ChatHistoryDropdown', () => {
  const sampleTask: TaskSessionRecord = {
    id: 'task-resume-1',
    workspacePath: '/projects/repo',
    harnessId: 'codex',
    modelId: 'gpt-5',
    title: 'Auth feature',
    nativeSessionId: 'codex-sess-1',
    state: 'resumable',
    createdAt: 1000,
    updatedAt: 1000,
    version: 1,
  };

  const sampleSession: HarnessSession = {
    id: 'codex-sess-1',
    harness: 'codex',
    title: 'Auth conversation',
    cwd: '/projects/repo',
    timestamp: 1200,
  };

  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      terminals: [],
      panes: [],
    });
  });

  it('renders tasks and discovered sessions', async () => {
    installElectronApiMock({
      taskSessionList: vi.fn().mockResolvedValue([sampleTask]),
    });

    render(
      <ChatHistoryDropdown
        sessions={[sampleSession]}
        isLoading={false}
        workspacePath="/projects/repo"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('Auth feature')).toBeInTheDocument();
    expect(screen.getByText('Resumable')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
  });

  it('handles resume failure gracefully by updating task state and displaying error and retry', async () => {
    const taskSessionUpdateMock = vi.fn().mockResolvedValue(null);
    const failedTask: TaskSessionRecord = {
      ...sampleTask,
      state: 'unavailable',
      stateReason: 'Failed to resume: Session file corrupted on disk',
    };
    const taskSessionListMock = vi.fn()
      .mockResolvedValueOnce([sampleTask])
      .mockResolvedValueOnce([failedTask]);

    installElectronApiMock({
      taskSessionList: taskSessionListMock,
      invokeSession: vi.fn().mockRejectedValue(new Error('Session file corrupted on disk')),
      taskSessionUpdate: taskSessionUpdateMock,
    });

    const onClose = vi.fn();
    render(
      <ChatHistoryDropdown
        sessions={[sampleSession]}
        isLoading={false}
        workspacePath="/projects/repo"
        onClose={onClose}
      />,
    );

    const resumeBtn = await screen.findByRole('button', { name: /resume/i });
    fireEvent.click(resumeBtn);

    await waitFor(() => {
      expect(taskSessionUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'task-resume-1',
          state: 'unavailable',
          stateReason: expect.stringContaining('Session file corrupted on disk'),
        }),
      );
    });

    // Dropdown did not close silently
    expect(onClose).not.toHaveBeenCalled();
    // Error banner is rendered in the UI
    expect(screen.getAllByText(/Session file corrupted on disk/i).length).toBeGreaterThanOrEqual(1);
    // Final state follows Option A failure policy: Unavailable badge and Retry button rendered
    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
