import { useEffect, useState } from 'react';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import { Tag, Circle, GitBranch, Folder, Server } from 'lucide-react';
import { getRemoteEnvironmentLabel, getRemoteEnvironmentName, getWorkspaceProjectName } from '../lib/workspaceLabels';
import { getSelectedAgentWorktreeContext, worktreeBranchLabel, worktreeDisplayLabel } from '../lib/worktreeAgents';
import { useAgentLocation } from '../lib/useAgentLocation';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { useAssistantsStore } from '../store/assistantsStore';
import { useCheckoutNoticeStore } from '../store/checkoutNoticeStore';
import './StatusBar.css';

export default function StatusBar() {
  const focusedWorkspace = useWorkspaceStore((state) => selectFocusedWorkspace(state));
  // The checkout the selected agent is working in decides what is shown: its reported location once
  // it has one, else its launch context. Only an isolated worktree differs from the workspace's own
  // checkout; the workspace's path and branch state are never altered by it.
  const selectedLocation = useAgentLocation(focusedWorkspace?.activeTerminalId);
  const agentWorktree = focusedWorkspace ? getSelectedAgentWorktreeContext(focusedWorkspace, selectedLocation) : null;
  const workspacePath = agentWorktree?.path ?? focusedWorkspace?.workspacePath ?? '';
  const currentBranch = agentWorktree ? (agentWorktree.branch ? worktreeDisplayLabel(agentWorktree) : null) : focusedWorkspace?.gitCurrentBranch ?? null;
  const isRepo = agentWorktree ? true : focusedWorkspace?.gitIsRepo ?? false;
  const isDetached = agentWorktree ? !agentWorktree.branch : focusedWorkspace?.gitIsDetached ?? false;
  const activeAssistantId = useAssistantNavStore((state) => state.activeAssistantId);
  const activeAssistantName = useAssistantsStore((state) => (activeAssistantId ? state.knownAssistants[activeAssistantId]?.displayName ?? activeAssistantId.replace(/^hermes:/, '') : null));
  const [appVersion, setAppVersion] = useState<string>('');
  // The outcome of a checkout transition main performed for an agent (which can no longer be told).
  const notice = useCheckoutNoticeStore((state) => state.notice);
  const dismissNotice = useCheckoutNoticeStore((state) => state.dismiss);
  const visibleNotice = notice && (!focusedWorkspace || notice.workspaceId === focusedWorkspace.id) ? notice : null;
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => dismissNotice(notice.id), 20_000);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setAppVersion);
  }, []);

  const projectName = focusedWorkspace ? getWorkspaceProjectName(focusedWorkspace) : 'No workspace selected';
  const remoteLabel = focusedWorkspace ? getRemoteEnvironmentLabel(focusedWorkspace) : null;
  const remoteName = focusedWorkspace ? getRemoteEnvironmentName(focusedWorkspace) : null;

  return (
    <footer className="status-bar">
      <div className="status-left">
        <span className="status-item">
          <Tag size={12} strokeWidth={2} />
          {appVersion ? `v${appVersion}` : ''}
        </span>
      </div>
      
      <div className="status-center">
        {activeAssistantName ? (
          <span className="status-project" data-testid="status-assistant">{activeAssistantName} · Hermes Bot Chat</span>
        ) : (<>
        {remoteLabel && (
          <span className="status-environment" title={remoteLabel}>
            <Server size={12} strokeWidth={2} aria-hidden="true" />
            <span className="status-environment-name">{remoteName}</span>
          </span>
        )}
        <span className="status-project" title={workspacePath}>
          {focusedWorkspace && <Folder size={12} strokeWidth={2} aria-hidden="true" />}
          <span className="status-project-name">{projectName}</span>
        </span>
        {isRepo && (
          <span
            className="status-branch"
            title={agentWorktree
              ? `${worktreeBranchLabel(agentWorktree)} (selected agent's isolated worktree${agentWorktree.missing ? ', checkout removed' : ''})\n${agentWorktree.path}`
              : isDetached ? 'Detached HEAD' : currentBranch ?? ''}
          >
            <GitBranch size={12} strokeWidth={2} />
            <span>{isDetached ? 'HEAD' : currentBranch}</span>
          </span>
        )}
        </>)}
      </div>
      
      <div className="status-right">
        {visibleNotice && (
          <button
            type="button"
            className={`status-item status-notice status-notice-${visibleNotice.tone}`}
            role="status"
            title={`${visibleNotice.message}\n(click to dismiss)`}
            onClick={() => dismissNotice(visibleNotice.id)}
          >
            {visibleNotice.message}
          </button>
        )}
        <span className="status-item">
          <Circle size={8} fill="var(--status-success)" strokeWidth={0} />
          Ready
        </span>
      </div>
    </footer>
  );
}
