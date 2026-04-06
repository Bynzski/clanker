import { useState, useEffect } from 'react';
import { GitBranch } from 'lucide-react';
import CommitDialog from './CommitDialog';
import './GitButton.css';

interface GitStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
  staged: boolean;
}

interface GitButtonProps {
  workspacePath: string;
}

export default function GitButton({ workspacePath }: GitButtonProps) {
  const [changeCount, setChangeCount] = useState(0);
  const [isRepo, setIsRepo] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [changes, setChanges] = useState<GitStatus[]>([]);

  // Start/stop polling when workspace changes
  useEffect(() => {
    if (!workspacePath) {
      setChangeCount(0);
      setIsRepo(false);
      setChanges([]);
      return;
    }

    // Start polling via backend service
    window.electronAPI.gitStartPolling(workspacePath);

    return () => {
      window.electronAPI.gitStopPolling();
    };
  }, [workspacePath]);

  // Listen for status updates from the backend
  useEffect(() => {
    const unsubscribe = window.electronAPI.onGitStatusUpdate((status) => {
      if (status.success) {
        setIsRepo(status.isRepo);
        setChangeCount(status.changes.length);
        setChanges(status.changes);
      } else {
        setIsRepo(false);
        setChangeCount(0);
        setChanges([]);
      }
    });

    return unsubscribe;
  }, []);

  const handleCommit = async (message: string) => {
    return window.electronAPI.gitCommit(workspacePath, message);
  };

  const handleStage = async () => {
    await window.electronAPI.gitStage(workspacePath);
  };

  const handleOpenDialog = async () => {
    // Force a refresh when opening dialog
    const status = await window.electronAPI.gitRefresh();
    if (status) {
      setChanges(status.changes);
      setChangeCount(status.changes.length);
    }
    setIsDialogOpen(true);
  };

  // Don't render if not a git repository
  if (!isRepo) {
    return null;
  }

  return (
    <>
      <button
        className="header-btn git-btn"
        onClick={handleOpenDialog}
        title="Git - View changes and commit"
      >
        <GitBranch size={15} strokeWidth={2} />
        {changeCount > 0 && (
          <span className="git-badge">{changeCount > 99 ? '99+' : changeCount}</span>
        )}
      </button>

      <CommitDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onCommit={handleCommit}
        onStageAll={handleStage}
        changes={changes}
      />
    </>
  );
}
