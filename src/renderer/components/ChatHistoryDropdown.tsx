import { useState } from 'react';
import { useEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { HarnessSession } from '../../shared/types/session';
import type { TaskSessionRecord } from '../../shared/types/taskSessions';
import TaskRecoverySection from './TaskRecoverySection';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';
import { getSessionDisplayTitles } from '../lib/sessionTitles';
import './ChatHistoryDropdown.css';

interface Props {
  sessions: HarnessSession[];
  isLoading: boolean;
  workspacePath: string;
  onClose: () => void;
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const minutes = diff / (1000 * 60);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 2) return 'yesterday';
  if (days < 7) return `${Math.floor(days)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

interface HarnessGroupProps {
  harnessId: string;
  sessions: HarnessSession[];
  isExpanded: boolean;
  onToggle: () => void;
  onSessionClick: (session: HarnessSession) => void;
  displayTitles: Map<string, string>;
}

function HarnessGroup({ harnessId, sessions, isExpanded, onToggle, onSessionClick, displayTitles }: HarnessGroupProps) {
  const harnessOpt = HARNESS_OPTIONS.find((o) => o.id === harnessId);

  return (
    <div className="chat-history-harness">
      <button
        type="button"
        className={`chat-history-harness-header ${isExpanded ? 'expanded' : ''}`}
        onClick={onToggle}
      >
        <span className="chat-history-harness-icon">
          {harnessOpt && <harnessOpt.Icon size={11} strokeWidth={2.5} />}
        </span>
        <span className="chat-history-harness-label">{harnessOpt?.label ?? harnessId}</span>
        <span className="chat-history-harness-count">{sessions.length}</span>
        <span className={`chat-history-harness-chevron ${isExpanded ? 'open' : ''}`}>
          ▼
        </span>
      </button>

      {isExpanded && (
        <div className="chat-history-harness-sessions">
          {sessions.length === 0 ? (
            <div className="chat-history-harness-empty">No sessions</div>
          ) : (
            sessions.map((session) => (
              <button
                key={`${session.harness}-${session.id}`}
                type="button"
                className="chat-history-session"
                onClick={() => onSessionClick(session)}
                title={`${session.title}\n${session.cwd}`}
              >
                <span className="chat-history-session-title">
                  {displayTitles.get(`${session.harness}\0${session.id}`) ?? session.title}
                </span>
                {session.timestamp > 0 && (
                  <span className="chat-history-session-time">
                    {formatRelativeTime(session.timestamp)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatHistoryDropdown({
  sessions,
  isLoading,
  workspacePath,
  onClose,
}: Props) {
  const addTerminal = useWorkspaceStore((state) => state.addTerminal);
  const setActiveTerminal = useWorkspaceStore((state) => state.setActiveTerminal);
  const [tasks, setTasks] = useState<TaskSessionRecord[]>([]);
  const [resumeError, setResumeError] = useState<{ taskId: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (typeof window.electronAPI?.taskSessionList === 'function') {
      window.electronAPI.taskSessionList(workspacePath)
        .then((res) => {
          if (!cancelled) setTasks(res);
        })
        .catch((err) => {
          console.error('Failed to load task sessions:', err);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  const handleResumeTask = async (task: TaskSessionRecord) => {
    if (!task.nativeSessionId) return;
    setResumeError(null);
    try {
      const sessionPayload: HarnessSession = {
        id: task.nativeSessionId,
        harness: task.harnessId as HarnessSession['harness'],
        title: task.title,
        cwd: task.workspacePath,
        timestamp: task.updatedAt,
        modelId: task.modelId,
        filePath: task.nativeSessionPath,
      };
      const info = await window.electronAPI.invokeSession(sessionPayload);
      addTerminal({
        id: info.id,
        pid: info.pid,
        workingDir: workspacePath,
        harnessId: sessionPayload.harness,
        attentionEnabled: info.attentionEnabled === true,
      });
      if (typeof window.electronAPI?.taskSessionList === 'function') {
        const updated = await window.electronAPI.taskSessionList(workspacePath);
        setTasks(updated);
      }
      onClose();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('Failed to resume task:', err);
      setResumeError({ taskId: task.id, message: errorMsg });
      if (typeof window.electronAPI?.taskSessionUpdate === 'function') {
        try {
          await window.electronAPI.taskSessionUpdate({
            id: task.id,
            state: 'unavailable',
            stateReason: `Failed to resume: ${errorMsg}`,
          });
          const updated = await window.electronAPI.taskSessionList(workspacePath);
          setTasks(updated);
        } catch {
          // Ignore secondary update error
        }
      }
    }
  };

  const handleAssociateSession = async (task: TaskSessionRecord, session: HarnessSession) => {
    try {
      if (typeof window.electronAPI?.taskSessionUpdate === 'function') {
        await window.electronAPI.taskSessionUpdate({
          id: task.id,
          nativeSessionId: session.id,
          nativeSessionPath: session.filePath,
          state: 'resumable',
        });
        const updated = await window.electronAPI.taskSessionList(workspacePath);
        setTasks(updated);
      }
    } catch (err) {
      console.error('Failed to associate session with task:', err);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      if (typeof window.electronAPI?.taskSessionDelete === 'function') {
        await window.electronAPI.taskSessionDelete(taskId);
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
      }
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  const handleFocusTerminal = (terminalId: string) => {
    setActiveTerminal(terminalId);
    onClose();
  };
  const handleSessionClick = async (session: HarnessSession) => {
    try {
      const info = await window.electronAPI.invokeSession(session);
      addTerminal({ id: info.id, pid: info.pid, workingDir: workspacePath, harnessId: session.harness, attentionEnabled: info.attentionEnabled === true });
      onClose();
    } catch (err) {
      console.error('Failed to invoke session:', err);
    }
  };

  const grouped: Record<string, HarnessSession[]> = {};
  const displayTitles = getSessionDisplayTitles(sessions);
  for (const session of sessions) {
    if (!grouped[session.harness]) grouped[session.harness] = [];
    grouped[session.harness].push(session);
  }

  const harnessOrder = HARNESS_OPTIONS.map((option) => option.id).filter(Boolean);
  const sortedHarnesses = Object.keys(grouped).sort(
    (a, b) => harnessOrder.indexOf(a) - harnessOrder.indexOf(b)
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleHarness = (harnessId: string) => {
    setExpanded((prev) => ({ ...prev, [harnessId]: !prev[harnessId] }));
  };

  return (
    <div className="chat-history-dropdown">
      <TaskRecoverySection
        tasks={tasks}
        discoveredSessions={sessions}
        onResumeTask={handleResumeTask}
        onAssociateSession={handleAssociateSession}
        onDeleteTask={handleDeleteTask}
        onFocusTerminal={handleFocusTerminal}
        resumeError={resumeError}
      />
      {isLoading ? (
        <div className="chat-history-empty">Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div className="chat-history-empty">No sessions for this workspace</div>
      ) : (
        sortedHarnesses.map((harness) => (
          <HarnessGroup
            key={harness}
            harnessId={harness}
            sessions={grouped[harness]}
            isExpanded={!!expanded[harness]}
            onToggle={() => toggleHarness(harness)}
            onSessionClick={handleSessionClick}
            displayTitles={displayTitles}
          />
        ))
      )}
    </div>
  );
}
