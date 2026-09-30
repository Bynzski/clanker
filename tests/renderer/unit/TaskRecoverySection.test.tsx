import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TaskSessionRecord } from '../../../src/shared/types/taskSessions';
import type { HarnessSession } from '../../../src/shared/types/session';
import TaskRecoverySection from '../../../src/renderer/components/TaskRecoverySection';

describe('TaskRecoverySection', () => {
  const mockTasks: TaskSessionRecord[] = [
    {
      id: 'task-1',
      workspacePath: '/projects/repo',
      harnessId: 'codex',
      modelId: 'gpt-5',
      title: 'Active Task',
      terminalId: 'term-active',
      state: 'running',
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    },
    {
      id: 'task-2',
      workspacePath: '/projects/repo',
      harnessId: 'claude',
      title: 'Stopped Resumable Task',
      nativeSessionId: 'sess-claude-1',
      state: 'resumable',
      createdAt: 2000,
      updatedAt: 2000,
      version: 1,
    },
    {
      id: 'task-3',
      workspacePath: '/projects/repo',
      harnessId: 'pi',
      title: 'Unlinked Task',
      state: 'needs-selection',
      createdAt: 3000,
      updatedAt: 3000,
      version: 1,
    },
    {
      id: 'task-4',
      workspacePath: '/projects/repo',
      harnessId: 'hermes',
      title: 'Unavailable Task',
      state: 'unavailable',
      stateReason: 'Harness hermes does not support conversation resume',
      createdAt: 4000,
      updatedAt: 4000,
      version: 1,
    },
  ];

  const mockDiscovered: HarnessSession[] = [
    {
      id: 'sess-pi-discovered',
      harness: 'pi',
      title: 'Discovered Pi Chat',
      cwd: '/projects/repo',
      timestamp: 3500,
    },
  ];

  it('renders tasks with appropriate status badges and details', () => {
    render(
      <TaskRecoverySection
        tasks={mockTasks}
        discoveredSessions={mockDiscovered}
        onResumeTask={vi.fn()}
        onAssociateSession={vi.fn()}
        onDeleteTask={vi.fn()}
      />,
    );

    expect(screen.getByText('Active Task')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();

    expect(screen.getByText('Stopped Resumable Task')).toBeInTheDocument();
    expect(screen.getByText('Resumable')).toBeInTheDocument();

    expect(screen.getByText('Unlinked Task')).toBeInTheDocument();
    expect(screen.getByText('Needs Session')).toBeInTheDocument();

    expect(screen.getByText('Unavailable Task')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText(/does not support conversation resume/)).toBeInTheDocument();
  });

  it('triggers onResumeTask when clicking Resume on a resumable task', async () => {
    const onResume = vi.fn().mockResolvedValue(undefined);

    render(
      <TaskRecoverySection
        tasks={mockTasks}
        discoveredSessions={mockDiscovered}
        onResumeTask={onResume}
        onAssociateSession={vi.fn()}
        onDeleteTask={vi.fn()}
      />,
    );

    const resumeBtn = screen.getByRole('button', { name: /resume/i });
    fireEvent.click(resumeBtn);

    await waitFor(() => {
      expect(onResume).toHaveBeenCalledWith(mockTasks[1]);
    });
  });

  it('opens session picker and associates chosen session for needs-selection tasks', async () => {
    const onAssociate = vi.fn().mockResolvedValue(undefined);

    render(
      <TaskRecoverySection
        tasks={mockTasks}
        discoveredSessions={mockDiscovered}
        onResumeTask={vi.fn()}
        onAssociateSession={onAssociate}
        onDeleteTask={vi.fn()}
      />,
    );

    const selectBtn = screen.getByRole('button', { name: /select/i });
    fireEvent.click(selectBtn);

    expect(screen.getByText('Discovered Pi Chat')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Discovered Pi Chat'));

    await waitFor(() => {
      expect(onAssociate).toHaveBeenCalledWith(mockTasks[2], mockDiscovered[0]);
    });
  });

  it.each(['disk', 'the remote host'])('lets a task missing on %s select an unclaimed session', async (location) => {
    const unavailable: TaskSessionRecord = {
      id: 'task-missing', workspacePath: '/projects/repo', harnessId: 'codex',
      title: 'Missing chat', nativeSessionId: 'old-id', state: 'unavailable',
      stateReason: `Native conversation session was not found on ${location}`,
      environmentId: location === 'disk' ? 'local' : 'vps',
      createdAt: 1, updatedAt: 1, version: 1,
    };
    const owner: TaskSessionRecord = { ...unavailable, id: 'owner', title: 'Owner',
      nativeSessionId: 'claimed', state: 'resumable', stateReason: undefined };
    const sessions: HarnessSession[] = [
      { id: 'claimed', harness: 'codex', title: 'Claimed chat', cwd: '/projects/repo', timestamp: 2 },
      { id: 'unclaimed', harness: 'codex', title: 'Free chat', cwd: '/projects/repo', timestamp: 3 },
    ];
    const onAssociate = vi.fn().mockResolvedValue(undefined);
    render(<TaskRecoverySection tasks={[unavailable, owner]} discoveredSessions={sessions}
      onResumeTask={vi.fn()} onAssociateSession={onAssociate} onDeleteTask={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /select session/i }));
    expect(screen.getByText('Free chat')).toBeInTheDocument();
    expect(screen.queryByText('Claimed chat')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Free chat'));
    await waitFor(() => expect(onAssociate).toHaveBeenCalledWith(unavailable, sessions[1]));
  });

  it('triggers onDeleteTask when clicking trash icon', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <TaskRecoverySection
        tasks={mockTasks}
        discoveredSessions={mockDiscovered}
        onResumeTask={vi.fn()}
        onAssociateSession={vi.fn()}
        onDeleteTask={onDelete}
      />,
    );

    const deleteBtns = screen.getAllByRole('button', { name: /delete task/i });
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('task-1');
    });
  });

  it('triggers onFocusTerminal when clicking focus on a running task', () => {
    const onFocus = vi.fn();

    render(
      <TaskRecoverySection
        tasks={mockTasks}
        discoveredSessions={mockDiscovered}
        onResumeTask={vi.fn()}
        onAssociateSession={vi.fn()}
        onDeleteTask={vi.fn()}
        onFocusTerminal={onFocus}
      />,
    );

    const focusBtn = screen.getByTitle('Focus terminal');
    fireEvent.click(focusBtn);

    expect(onFocus).toHaveBeenCalledWith('term-active');
  });
  it('renders resume error banner when resumeError is provided', () => {
    render(
      <TaskRecoverySection
        tasks={mockTasks}
        discoveredSessions={mockDiscovered}
        onResumeTask={vi.fn()}
        onAssociateSession={vi.fn()}
        onDeleteTask={vi.fn()}
        resumeError={{ taskId: 'task-2', message: 'Harness binary exited with error' }}
      />,
    );

    expect(screen.getByText('Harness binary exited with error')).toBeInTheDocument();
  });
});
