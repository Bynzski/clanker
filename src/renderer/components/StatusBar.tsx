import { useWorkspaceStore } from '../store/workspaceStore';
import { Terminal, Circle } from 'lucide-react';
import './StatusBar.css';

export default function StatusBar() {
  const { terminals, workspacePath } = useWorkspaceStore();

  const displayPath = workspacePath.length > 60
    ? '...' + workspacePath.slice(-57)
    : workspacePath || 'No workspace selected';

  return (
    <footer className="status-bar">
      <div className="status-left">
        <span className="status-item">
          <Terminal size={12} strokeWidth={2} />
          {terminals.length} terminal{terminals.length !== 1 ? 's' : ''}
        </span>
      </div>
      
      <div className="status-center">
        <span className="status-path" title={workspacePath}>
          {displayPath}
        </span>
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
