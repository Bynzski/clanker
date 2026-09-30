import { useEffect, useState } from 'react';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import { Tag, Circle, GitBranch, Folder } from 'lucide-react';
import { getRemoteEnvironmentLabel, getWorkspaceProjectName } from '../lib/workspaceLabels';
import './StatusBar.css';

export default function StatusBar() {
  const focusedWorkspace = useWorkspaceStore((state) => selectFocusedWorkspace(state));
  const workspacePath = focusedWorkspace?.workspacePath ?? '';
  const currentBranch = focusedWorkspace?.gitCurrentBranch ?? null;
  const isRepo = focusedWorkspace?.gitIsRepo ?? false;
  const isDetached = focusedWorkspace?.gitIsDetached ?? false;
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setAppVersion);
  }, []);

  const projectName = focusedWorkspace ? getWorkspaceProjectName(focusedWorkspace) : 'No workspace selected';
  const remoteLabel = focusedWorkspace ? getRemoteEnvironmentLabel(focusedWorkspace) : null;

  return (
    <footer className="status-bar">
      <div className="status-left">
        <span className="status-item">
          <Tag size={12} strokeWidth={2} />
          {appVersion ? `v${appVersion}` : ''}
        </span>
      </div>
      
      <div className="status-center">
        {remoteLabel && <span className="status-environment" title={remoteLabel}>{remoteLabel}</span>}
        <span className="status-project" title={workspacePath}>
          {focusedWorkspace && <Folder size={12} strokeWidth={2} aria-hidden="true" />}
          <span className="status-project-name">{projectName}</span>
        </span>
        {isRepo && (
          <span className="status-branch" title={isDetached ? 'Detached HEAD' : currentBranch ?? ''}>
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
