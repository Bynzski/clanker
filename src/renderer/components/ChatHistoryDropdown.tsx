import { useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { HarnessSession } from '../../shared/types/session';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';
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
}

function HarnessGroup({ harnessId, sessions, isExpanded, onToggle, onSessionClick }: HarnessGroupProps) {
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
                title={session.cwd}
              >
                <span className="chat-history-session-title">{session.title}</span>
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

  const handleSessionClick = async (session: HarnessSession) => {
    try {
      const info = await window.electronAPI.invokeSession(session);
      addTerminal({ id: info.id, pid: info.pid, workingDir: workspacePath });
      onClose();
    } catch (err) {
      console.error('Failed to invoke session:', err);
    }
  };

  const grouped: Record<string, HarnessSession[]> = {};
  for (const session of sessions) {
    if (!grouped[session.harness]) grouped[session.harness] = [];
    grouped[session.harness].push(session);
  }

  const harnessOrder = ['claude', 'codex', 'opencode', 'pi'];
  const sortedHarnesses = Object.keys(grouped).sort(
    (a, b) => harnessOrder.indexOf(a) - harnessOrder.indexOf(b)
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleHarness = (harnessId: string) => {
    setExpanded((prev) => ({ ...prev, [harnessId]: !prev[harnessId] }));
  };

  return (
    <div className="chat-history-dropdown">
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
          />
        ))
      )}
    </div>
  );
}
