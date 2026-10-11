import { useEffect, useState } from 'react';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import { Tag, Circle, GitBranch, Folder, Server } from 'lucide-react';
import { getRemoteEnvironmentLabel, getRemoteEnvironmentName, getWorkspaceProjectName } from '../lib/workspaceLabels';
import { selectCheckout, checkoutUnavailableMessage, checkoutUnavailableLabel } from '../lib/checkoutSelection';
import { checkoutSelectionToken } from '../lib/checkoutSelectionRuntime';
import { useAgentSnapshot } from '../lib/useAgentLocation';
import { matchingCheckoutGit, useCheckoutGitStore, checkoutGitAvailability } from '../store/checkoutGitStore';
import { useAssistantNavStore } from '../store/assistantNavStore';
import { useAssistantsStore } from '../store/assistantsStore';
import { NotificationCenter } from './NotificationCenter';
import UsageWidget from './UsageWidget';
import { WorkspacePageSwitcher } from './WorkspacePageControls';
import './StatusBar.css';

export default function StatusBar() {
  const focusedWorkspace = useWorkspaceStore((state) => selectFocusedWorkspace(state));
  const selectedSnapshot = useAgentSnapshot(focusedWorkspace?.activeTerminalId);
  const selected = focusedWorkspace ? selectCheckout(focusedWorkspace, selectedSnapshot) : null;
  const workspacePath = selected?.root ?? '';
  const activeGit = useCheckoutGitStore((state) => state.active);
  const git = selected?.availability === 'available' ? matchingCheckoutGit(activeGit, {
    workspaceId: selected.workspaceId, environmentId: selected.environmentId, contextId: selected.contextId ?? undefined, root: selected.root, selectionGeneration: checkoutSelectionToken(selected.workspaceId),
  }) : null;
  const gitAvailability = checkoutGitAvailability(git);
  const gitLabel = gitAvailability === 'loading' ? 'Git loading…' : 'Git status unavailable';
  const status = git?.state === 'ready' ? git.result : null;
  const metadata = selected?.availability === 'available' ? selected.context : null;
  const isMain = metadata?.path === focusedWorkspace?.workspacePath;
  const currentBranch = status?.currentBranch ?? (isMain ? focusedWorkspace?.gitCurrentBranch ?? null : metadata?.branch ?? null);
  const isRepo = status?.isRepo ?? (metadata ? !isMain || focusedWorkspace?.gitIsRepo === true : false);
  const isDetached = status?.isDetached ?? (metadata ? isMain ? focusedWorkspace?.gitIsDetached === true : !metadata.branch : false);
  const unavailable = selected?.availability === 'unavailable' ? checkoutUnavailableMessage(selected.reason) : null;
  const activeAssistantId = useAssistantNavStore((state) => state.activeAssistantId);
  const activeAssistantName = useAssistantsStore((state) => (activeAssistantId ? state.knownAssistants[activeAssistantId]?.displayName ?? activeAssistantId.replace(/^hermes:/, '') : null));
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
        {!activeAssistantId && focusedWorkspace && <WorkspacePageSwitcher key={focusedWorkspace.id} workspace={focusedWorkspace} />}
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
        {selected?.availability === 'unavailable' && <span className="status-checkout-unavailable" data-checkout-state="unavailable" title={unavailable ?? undefined}>{checkoutUnavailableLabel(selected.reason)}</span>}
        {selected?.availability === 'available' && gitAvailability !== 'ready' && <span className="status-git-availability" data-git-state={gitAvailability} title={gitLabel}>{gitLabel}</span>}
        {isRepo && (
          <span
            className="status-branch"
            title={`${status ? 'Current Git branch' : `Last-known branch metadata · ${gitLabel}`}\n${isDetached ? 'Detached HEAD' : currentBranch ?? ''}\n${workspacePath}`}
          >
            <GitBranch size={12} strokeWidth={2} />
            <span>{isDetached ? 'HEAD' : currentBranch}</span>
          </span>
        )}
        </>)}
      </div>
      
      <div className="status-right">
        <UsageWidget />
        <NotificationCenter />
        <span className="status-item">
          <Circle size={8} fill="var(--status-success)" strokeWidth={0} />
          Ready
        </span>
      </div>
    </footer>
  );
}
