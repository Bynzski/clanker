import { useState } from 'react';
import {
  Trash2,
  AlertTriangle,
  RotateCcw,
  CheckCircle,
  Clock,
  ChevronDown,
  Terminal,
} from 'lucide-react';
import type { TaskSessionRecord } from '../../shared/types/taskSessions';
import type { HarnessSession } from '../../shared/types/session';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';
import './TaskRecoverySection.css';

interface Props {
  tasks: TaskSessionRecord[];
  discoveredSessions: HarnessSession[];
  onResumeTask: (task: TaskSessionRecord) => Promise<void>;
  onAssociateSession: (task: TaskSessionRecord, session: HarnessSession) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onFocusTerminal?: (terminalId: string) => void;
  resumeError?: { taskId: string; message: string } | null;
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

export default function TaskRecoverySection({
  tasks,
  discoveredSessions,
  onResumeTask,
  onAssociateSession,
  onDeleteTask,
  onFocusTerminal,
  resumeError,
}: Props) {
  const [selectingSessionTaskId, setSelectingSessionTaskId] = useState<string | null>(null);
  const [resumingTaskId, setResumingTaskId] = useState<string | null>(null);
  const [associationError, setAssociationError] = useState<{ taskId: string; message: string } | null>(null);

  if (tasks.length === 0) return null;

  const handleResume = async (task: TaskSessionRecord) => {
    setResumingTaskId(task.id);
    try {
      await onResumeTask(task);
    } finally {
      setResumingTaskId(null);
    }
  };

  const handleAssociate = async (task: TaskSessionRecord, session: HarnessSession) => {
    try {
      await onAssociateSession(task, session);
      setAssociationError(null);
      setSelectingSessionTaskId(null);
    } catch (err) {
      setAssociationError({ taskId: task.id, message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="task-recovery-section">
      <div className="task-recovery-header">
        <span className="task-recovery-title">Workspace Tasks</span>
        <span className="task-recovery-count">{tasks.length}</span>
      </div>

      <div className="task-recovery-list">
        {tasks.map((task) => {
          const harnessOpt = HARNESS_OPTIONS.find((h) => h.id === task.harnessId);
          const HarnessIcon = harnessOpt?.Icon ?? Terminal;
          const isResuming = resumingTaskId === task.id;
          const isSelecting = selectingSessionTaskId === task.id;

          // Matching discovered sessions for this task's harness
          const matchingSessions = discoveredSessions.filter((s) =>
            s.harness === task.harnessId
            && !tasks.some((owner) => owner.id !== task.id && owner.harnessId === task.harnessId && owner.nativeSessionId === s.id),
          );
          const canReassociate = task.state === 'needs-selection' || (task.state === 'unavailable'
            && /(?:not found on disk|failed to resume|resume failed)/i.test(task.stateReason ?? ''));

          return (
            <div key={task.id} className={`task-recovery-item ${task.state}`}>
              <div className="task-recovery-main">
                <div className="task-recovery-icon-col">
                  <HarnessIcon size={14} className="task-recovery-harness-icon" />
                </div>

                <div className="task-recovery-details">
                  <div className="task-recovery-name-row">
                    <span className="task-recovery-task-title" title={task.title}>
                      {task.title}
                    </span>
                    <span className={`task-recovery-state-badge ${task.state}`}>
                      {task.state === 'running' && <span className="task-state-pulse" />}
                      {task.state === 'running' && 'Running'}
                      {task.state === 'resumable' && 'Resumable'}
                      {task.state === 'needs-selection' && 'Needs Session'}
                      {task.state === 'unavailable' && 'Unavailable'}
                    </span>
                  </div>

                  <div className="task-recovery-meta-row">
                    <span className="task-recovery-harness-name">
                      {harnessOpt?.label ?? task.harnessId}
                      {task.modelId ? ` (${task.modelId})` : ''}
                    </span>
                    {task.updatedAt > 0 && (
                      <span className="task-recovery-time">
                        <Clock size={10} />
                        {formatRelativeTime(task.updatedAt)}
                      </span>
                    )}
                  </div>

                  {task.state === 'unavailable' && task.stateReason && (
                    <div className="task-recovery-reason" title={task.stateReason}>
                      <AlertTriangle size={11} />
                      <span>{task.stateReason}</span>
                    </div>
                  )}
                </div>

                <div className="task-recovery-actions">
                  {task.state === 'running' && task.terminalId && onFocusTerminal && (
                    <button
                      type="button"
                      className="task-action-btn focus-btn"
                      onClick={() => onFocusTerminal(task.terminalId!)}
                      title="Focus terminal"
                    >
                      <CheckCircle size={13} />
                    </button>
                  )}

                  {task.state === 'resumable' && (
                    <button
                      type="button"
                      className="task-action-btn resume-btn"
                      onClick={() => void handleResume(task)}
                      disabled={isResuming}
                      title="Resume conversation in a new terminal"
                    >
                      <RotateCcw size={12} className={isResuming ? 'spin' : ''} />
                      Resume
                    </button>
                  )}

                  {task.state === 'unavailable' && task.nativeSessionId && /(?:failed to resume|resume failed)/i.test(task.stateReason ?? '') && (
                    <button
                      type="button"
                      className="task-action-btn resume-btn"
                      onClick={() => void handleResume(task)}
                      disabled={isResuming}
                      title="Retry resuming conversation"
                    >
                      <RotateCcw size={12} className={isResuming ? 'spin' : ''} />
                      Retry
                    </button>
                  )}
                  {canReassociate && (
                    <button
                      type="button"
                      className="task-action-btn select-session-btn"
                      onClick={() => setSelectingSessionTaskId(isSelecting ? null : task.id)}
                      title="Select existing session to attach"
                    >
                      <span>Select Session</span>
                      <ChevronDown size={11} />
                    </button>
                  )}

                  <button
                    type="button"
                    className="task-action-btn delete-btn"
                    onClick={() => void onDeleteTask(task.id)}
                    title="Forget task record"
                    aria-label="Delete task"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {resumeError?.taskId === task.id && (
                <div className="task-recovery-error-banner">
                  <AlertTriangle size={11} />
                  <span>{resumeError.message}</span>
                </div>
              )}
              {associationError?.taskId === task.id && (
                <div className="task-recovery-error-banner"><AlertTriangle size={11} /><span>{associationError.message}</span></div>
              )}

              {isSelecting && (
                <div className="task-session-picker">
                  <div className="task-session-picker-title">Attach conversation:</div>
                  {matchingSessions.length === 0 ? (
                    <div className="task-session-picker-empty">No discovered sessions found.</div>
                  ) : (
                    <div className="task-session-picker-list">
                      {matchingSessions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="task-session-picker-item"
                          onClick={() => void handleAssociate(task, s)}
                        >
                          <span className="picker-session-title">{s.title || s.id}</span>
                          <span className="picker-session-time">{formatRelativeTime(s.timestamp)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
