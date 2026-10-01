import { Select } from './ui/Select';
import { ChevronDown, LayoutGrid, MessageSquare, ScrollText, Settings, Undo2 } from 'lucide-react';
import type { HarnessSession } from '../../shared/types/session';
import type { ModelOption } from '../types/shared';
import type { HarnessDefaultsMap } from '../../shared/types/store';
import { Popover, PopoverTrigger, PopoverContent } from './ui/Popover';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import ChatHistoryDropdown from './ChatHistoryDropdown';
import AppearanceSettings from './settings/AppearanceSettings';
import HarnessDefaultsSection from './settings/HarnessDefaultsSection';

interface HeaderRightControlsProps {
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
  settingsTriggerRef: React.RefObject<HTMLButtonElement | null>;
  onSettingsCloseAutoFocus: (event: Event) => void;
  showSettings: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  aiCommitEnabled: boolean;
  onToggleAiCommit: (checked: boolean) => void;
  aiCommitProvider: string;
  aiCommitProviderOptions: Array<{ id: string; label: string }>;
  onAiCommitProviderChange: (provider: string) => void;
  aiCommitModel: string;
  aiCommitModels: ModelOption[];
  isLoadingAiCommitModels: boolean;
  onAiCommitModelChange: (model: string) => void;
  onOpenCredentialModal: () => void;
  harnessDefaults: HarnessDefaultsMap | null;
  availableHarnessIds: string[];
  expandedHarness: string | null;
  setExpandedHarness: (id: string | null) => void;
  harnessModelCache: Record<string, ModelOption[]>;
  harnessModelLoading: Record<string, boolean>;
  loadHarnessModels: (harnessId: string) => Promise<void>;
  handleSetHarnessFlags: (harnessId: string, flags: string) => Promise<void>;
  handleSetHarnessVisible: (harnessId: string, visible: boolean) => Promise<void>;
  handleSetHarnessAttention: (harnessId: string, enabled: boolean) => Promise<void>;
  handleSetDefaultModel: (harnessId: string, modelId: string) => Promise<void>;
  handleToggleFavorite: (harnessId: string, modelId: string) => Promise<void>;
}

export default function HeaderRightControls({
  fitAllPanes,
  undoLayout,
  canUndoLayout,
  onOpenRecipes,
  showChatHistory,
  onChatHistoryOpenChange,
  chatSessions,
  isLoadingSessions,
  sessionDiscoveryError,
  workspacePath,
  workspaceId,
  onCloseChatHistory,
  settingsTriggerRef,
  onSettingsCloseAutoFocus,
  showSettings,
  onSettingsOpenChange,
  aiCommitEnabled,
  onToggleAiCommit,
  aiCommitProvider,
  aiCommitProviderOptions,
  onAiCommitProviderChange,
  aiCommitModel,
  aiCommitModels,
  isLoadingAiCommitModels,
  onAiCommitModelChange,
  onOpenCredentialModal,
  harnessDefaults,
  availableHarnessIds,
  expandedHarness,
  setExpandedHarness,
  harnessModelCache,
  harnessModelLoading,
  loadHarnessModels,
  handleSetHarnessFlags,
  handleSetHarnessVisible,
  handleSetHarnessAttention,
  handleSetDefaultModel,
  handleToggleFavorite,
}: HeaderRightControlsProps) {
  return (
    <div className="header-right">
      <IconButton
        className="header-btn header-btn-icon"
        type="button"
        onClick={undoLayout}
        disabled={!canUndoLayout}
        title="Undo last layout change"
        aria-label="Undo layout change"
      >
        <Undo2 size={15} strokeWidth={2} />
      </IconButton>
      {onOpenRecipes && (
        <IconButton
          className="header-btn header-btn-icon"
          type="button"
          onClick={onOpenRecipes}
          title="Workspace Launch Recipes"
          aria-label="Workspace Launch Recipes"
        >
          <ScrollText size={15} strokeWidth={2} />
        </IconButton>
      )}
      <IconButton
        className="header-btn header-btn-icon"
        type="button"
        onClick={fitAllPanes}
        title="Fit all panes into view (Ctrl/Cmd+Shift+F)"
        aria-label="Fit all panes"
      >
        <LayoutGrid size={15} strokeWidth={2} />
      </IconButton>
      <Popover open={showChatHistory} onOpenChange={onChatHistoryOpenChange}>
        <PopoverTrigger asChild>
          <IconButton
            className={`header-btn header-btn-icon ${showChatHistory ? 'active' : ''}`}
            title="Chat history"
            aria-label="Chat history"
          >
            <MessageSquare size={15} strokeWidth={2} />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="header-chat-popover" aria-label="Chat history" workspaceId={workspaceId ?? undefined}>
          <ChatHistoryDropdown
            sessions={chatSessions}
            isLoading={isLoadingSessions}
            discoveryError={sessionDiscoveryError}
            workspacePath={workspacePath || '/'}
            workspaceId={workspaceId}
            onClose={onCloseChatHistory}
          />
        </PopoverContent>
      </Popover>
      <Popover open={showSettings} onOpenChange={onSettingsOpenChange}>
        <PopoverTrigger asChild>
          <Button ref={settingsTriggerRef} className="header-btn" aria-label="Settings" title="Settings">
            <Settings size={15} strokeWidth={2} />
            <ChevronDown size={12} strokeWidth={2} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="settings-dropdown" aria-label="Settings"
          workspaceId={workspaceId ?? undefined} onCloseAutoFocus={onSettingsCloseAutoFocus}>
          <AppearanceSettings />
          <div className="settings-section">
            <label className="settings-option">
              <input
                type="checkbox"
                checked={aiCommitEnabled}
                onChange={(e) => onToggleAiCommit(e.target.checked)}
              />
              <span>AI commit messages</span>
            </label>

            <div className="settings-row">
              <span className="settings-row-label">Provider</span>
              <Select
                className="settings-select"
                aria-label="AI commit provider"
                value={aiCommitProvider}
                onChange={(e) => void onAiCommitProviderChange(e.target.value)}
                disabled={!aiCommitEnabled || aiCommitProviderOptions.length === 0}
              >
                {aiCommitProviderOptions.length === 0 ? (
                  <option value="">No providers available</option>
                ) : (
                  aiCommitProviderOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))
                )}
              </Select>
            </div>

            <div className="settings-row">
              <span className="settings-row-label">Model</span>
              <Select
                className="settings-select"
                aria-label="AI commit model"
                value={aiCommitModel}
                onChange={(e) => void onAiCommitModelChange(e.target.value)}
                disabled={!aiCommitEnabled || isLoadingAiCommitModels || aiCommitModels.length === 0}
              >
                {isLoadingAiCommitModels ? (
                  <option value="">Loading models...</option>
                ) : aiCommitModels.length === 0 ? (
                  <option value="">No models available</option>
                ) : (
                  <>
                    <option value="">Default model</option>
                    {aiCommitModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </>
                )}
              </Select>
            </div>
          </div>
          <Button type="button" className="settings-dropdown-action" onClick={onOpenCredentialModal}>
            Manage VCS credentials
          </Button>

          {harnessDefaults && (
            <HarnessDefaultsSection
              harnessDefaults={harnessDefaults}
              availableHarnessIds={availableHarnessIds}
              expandedHarness={expandedHarness}
              setExpandedHarness={setExpandedHarness}
              harnessModelCache={harnessModelCache}
              harnessModelLoading={harnessModelLoading}
              loadHarnessModels={loadHarnessModels}
              handleSetHarnessFlags={handleSetHarnessFlags}
              handleSetHarnessVisible={handleSetHarnessVisible}
              handleSetHarnessAttention={handleSetHarnessAttention}
              handleSetDefaultModel={handleSetDefaultModel}
              handleToggleFavorite={handleToggleFavorite}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
