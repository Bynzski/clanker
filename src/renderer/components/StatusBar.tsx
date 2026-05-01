import { useEffect, useState } from 'react';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import { Tag, Circle, GitBranch } from 'lucide-react';
import './StatusBar.css';

export default function StatusBar() {
  const focusedWorkspace = useWorkspaceStore((state) => selectFocusedWorkspace(state));
  const workspacePath = focusedWorkspace?.workspacePath ?? '';
  const currentBranch = useWorkspaceStore((state) => state.gitCurrentBranch);
  const isRepo = useWorkspaceStore((state) => state.gitIsRepo);
  const isDetached = useWorkspaceStore((state) => state.gitIsDetached);
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setAppVersion);
  }, []);

  const displayPath = workspacePath.length > 60
    ? '...' + workspacePath.slice(-57)
    : workspacePath || 'No workspace selected';

  return (
    <footer className="status-bar">
      <div className="status-left">
        <span className="status-item">
          <Tag size={12} strokeWidth={2} />
          {appVersion ? `v${appVersion}` : ''}
        </span>
      </div>
      
      <div className="status-center">
        <span className="status-path" title={workspacePath}>
          {displayPath}
        </span>
        {isRepo && (
          <span className="status-branch" title={isDetached ? 'Detached HEAD' : currentBranch ?? ''}>
            <GitBranch size={12} strokeWidth={2} />
            {isDetached ? 'HEAD' : currentBranch}
          </span>
        )}
      </div>
      
      <div className="status-right">
        <span className="status-item">
          <Circle size={8} fill="var(--accent-success)" strokeWidth={0} />
          Ready
        </span>
      </div>
    </footer>
  );
}
