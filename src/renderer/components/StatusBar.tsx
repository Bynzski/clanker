import { useEffect, useState } from 'react';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import { Tag, Circle, GitBranch, Folder, Server } from 'lucide-react';
import { getRemoteEnvironmentLabel, getRemoteEnvironmentName, getWorkspaceProjectName } from '../lib/workspaceLabels';
import { getSelectedAgentWorktreeContext, worktreeBranchLabel } from '../lib/worktreeAgents';
import './StatusBar.css';

export default function StatusBar() {
  const focusedWorkspace = useWorkspaceStore((state) => selectFocusedWorkspace(state));
  // The selected agent's registered checkout decides what is shown. Only an isolated worktree differs
  // from the workspace's own checkout; the workspace's path and branch state are never altered by it.
  const agentWorktree = focusedWorkspace ? getSelectedAgentWorktreeContext(focusedWorkspace) : null;
  const workspacePath = agentWorktree?.path ?? focusedWorkspace?.workspacePath ?? '';
  const currentBranch = agentWorktree ? agentWorktree.branch ?? null : focusedWorkspace?.gitCurrentBranch ?? null;
  const isRepo = agentWorktree ? true : focusedWorkspace?.gitIsRepo ?? false;
  const isDetached = agentWorktree ? !agentWorktree.branch : focusedWorkspace?.gitIsDetached ?? false;
  const [appVersion, setAppVersion] = useState<string>('');

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
              ? `${worktreeBranchLabel(agentWorktree)} (selected agent's isolated worktree)\n${agentWorktree.path}`
              : isDetached ? 'Detached HEAD' : currentBranch ?? ''}
          >
            <GitBranch size={12} strokeWidth={2} />
            <span>{isDetached ? 'HEAD' : currentBranch}</span>
          </span>
        )}
      </div>
      
      <div className="status-right">
        <span className="status-item">
          <Circle size={8} fill="var(--status-success)" strokeWidth={0} />
          Ready
        </span>
      </div>
    </footer>
  );
}
