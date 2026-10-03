import { useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { HarnessSession } from '../../shared/types/session';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';
import { getSessionDisplayTitles } from '../lib/sessionTitles';
import './ChatHistoryDropdown.css';

interface Props {
  sessions: HarnessSession[];
  isLoading: boolean;
  discoveryError?: string;
  workspacePath: string;
  workspaceId: string | null;
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
  launching: boolean;
}

function HarnessGroup({ harnessId, sessions, isExpanded, onToggle, onSessionClick, displayTitles, launching }: HarnessGroupProps) {
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
                disabled={launching}
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
  discoveryError,
  workspacePath,
  workspaceId,
  onClose,
}: Props) {
  const addTerminal = useWorkspaceStore((state) => state.addTerminal);
  const [launching, setLaunching] = useState(false);
  const [sessionLaunchError, setSessionLaunchError] = useState('');
  const environmentId = useWorkspaceStore((state) => state.getWorkspaceById(workspaceId)?.environmentId ?? 'local');
  const stillOwnsWorkspace = () => {
    const current = useWorkspaceStore.getState().getWorkspaceById(workspaceId);
    return current && (current.environmentId ?? 'local') === environmentId && current.workspacePath === workspacePath;
  };

  const handleSessionClick = async (session: HarnessSession) => {
    if (launching) return;
    setLaunching(true);
    setSessionLaunchError('');
    try {
      if (!workspaceId) throw new Error('Workspace is not registered');
      const info = await window.electronAPI.invokeSession(workspaceId, session);
      if (!stillOwnsWorkspace()) {
        await window.electronAPI.killTerminal(info.id);
        throw new Error('The workspace closed while resuming');
      }
      addTerminal({ id: info.id, pid: info.pid, workingDir: info.workingDir ?? session.cwd, workspaceId, environmentId, harnessId: session.harness, attentionEnabled: info.attentionEnabled === true }, workspaceId);
      if (useWorkspaceStore.getState().activeWorkspaceId === workspaceId) onClose();
    } catch (err) {
      console.error('Failed to invoke session:', err);
      setSessionLaunchError(err instanceof Error ? err.message : 'Could not resume session');
    } finally {
      setLaunching(false);
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
      {sessionLaunchError && <div className="chat-history-empty" role="alert">{sessionLaunchError}</div>}
      {isLoading ? (
        <div className="chat-history-empty">Loading sessions…</div>
      ) : discoveryError ? (
        <div className="chat-history-empty" role="alert">{discoveryError}</div>
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
            launching={launching}
          />
        ))
      )}
    </div>
  );
}
