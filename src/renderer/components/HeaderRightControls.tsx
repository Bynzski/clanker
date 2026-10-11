import { LayoutGrid, MessageSquare, ScrollText, Settings, Undo2 } from 'lucide-react';
import type { HarnessSession } from '../../shared/types/session';
import { Popover, PopoverTrigger, PopoverContent } from './ui/Popover';
import { IconButton } from './ui/IconButton';
import ChatHistoryDropdown from './ChatHistoryDropdown';
import type { DestinationCapabilities } from '../lib/activeDestination';
import { useApplicationSettings } from './settings/ApplicationSettingsProvider';

interface HeaderRightControlsProps {
  capabilities: DestinationCapabilities;
  panelToggles?: React.ReactNode;
  fitAllPanes: () => void;
  undoLayout: () => void;
  canUndoLayout: boolean;
  onOpenRecipes?: () => void;
  showChatHistory: boolean;
  onChatHistoryOpenChange: (open: boolean) => void;
  chatSessions: HarnessSession[];
  isLoadingSessions: boolean;
  sessionDiscoveryError?: string;
  workspacePath: string;
  workspaceId: string | null;
  onCloseChatHistory: () => void;
}

export default function HeaderRightControls({ capabilities, panelToggles, fitAllPanes, undoLayout,
  canUndoLayout, onOpenRecipes, showChatHistory, onChatHistoryOpenChange, chatSessions,
  isLoadingSessions, sessionDiscoveryError, workspacePath, workspaceId, onCloseChatHistory }: HeaderRightControlsProps) {
  const settings = useApplicationSettings();
  return (
    <div className="header-right">
      {panelToggles && <>{panelToggles}<span className="toolbar-divider" aria-hidden="true" /></>}
      {capabilities.layout && <>
        <IconButton size="xs" variant="ghost" className="header-btn header-btn-icon toolbar-btn"
          onClick={undoLayout} disabled={!canUndoLayout} title="Undo last layout change" aria-label="Undo layout change">
          <Undo2 size={14} strokeWidth={2} />
        </IconButton>
        <IconButton size="xs" variant="ghost" className="header-btn header-btn-icon toolbar-btn"
          onClick={fitAllPanes} title="Fit all panes into view" aria-label="Fit all panes">
          <LayoutGrid size={14} strokeWidth={2} />
        </IconButton>
      </>}
      {capabilities.recipes && onOpenRecipes &&
        <IconButton size="xs" variant="ghost" className="header-btn header-btn-icon toolbar-btn"
          onClick={onOpenRecipes} title="Workspace Launch Recipes" aria-label="Workspace Launch Recipes">
          <ScrollText size={14} strokeWidth={2} />
        </IconButton>}
      {capabilities.sessionHistory && <span className="toolbar-divider" aria-hidden="true" />}
      {capabilities.sessionHistory &&
        <Popover open={showChatHistory} onOpenChange={onChatHistoryOpenChange}>
          <PopoverTrigger asChild>
            <IconButton size="xs" variant="ghost" className={`header-btn toolbar-btn header-btn-icon ${showChatHistory ? 'active' : ''}`}
              title="Chat history" aria-label="Chat history"><MessageSquare size={14} strokeWidth={2} /></IconButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="header-chat-popover" aria-label="Chat history" workspaceId={workspaceId ?? undefined}>
            <ChatHistoryDropdown sessions={chatSessions} isLoading={isLoadingSessions} discoveryError={sessionDiscoveryError}
              workspacePath={workspacePath || '/'} workspaceId={workspaceId} onClose={onCloseChatHistory} />
          </PopoverContent>
        </Popover>}
      <IconButton ref={settings.settingsTriggerRef} size="xs" variant="ghost"
        className={`header-btn toolbar-btn header-btn-icon ${settings.showSettings ? 'active' : ''}`}
        aria-label="Settings" title="Settings" aria-haspopup="dialog" aria-expanded={settings.showSettings}
        onClick={() => { onCloseChatHistory(); settings.openSettings(); }}>
        <Settings size={14} strokeWidth={2} />
      </IconButton>
    </div>
  );
}
