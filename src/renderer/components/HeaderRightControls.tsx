import { Select } from './ui/Select';
import { useRef } from 'react';
import { ChevronRight, Gauge, Keyboard, KeyRound, LayoutGrid, MessageSquare, ScrollText, Settings, Undo2 } from 'lucide-react';
import type { HarnessSession } from '../../shared/types/session';
import type { ModelOption } from '../types/shared';
import type { HarnessDefaultsMap } from '../../shared/types/store';
import { Popover, PopoverTrigger, PopoverContent } from './ui/Popover';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import ChatHistoryDropdown from './ChatHistoryDropdown';
import UsageDropdown from './UsageDropdown';
import type { UseHarnessUsageResult } from './useHarnessUsage';
import type { DestinationCapabilities } from '../lib/activeDestination';
import AssistantsSettings from './settings/AssistantsSettings';
import AppearanceSettings from './settings/AppearanceSettings';
import HarnessDefaultsSection from './settings/HarnessDefaultsSection';

interface HeaderRightControlsProps {
  /** Panel visibility toggles (Explorer/Browser/Notes), shown first in the right-hand group. */
  /** What the active destination supports; workspace-scoped controls are removed when it is not a workspace. */
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
  /** Environment of the focused workspace; scopes account management. Absent only when there is none. */
  environmentId?: string;
  accountIntent?: { harness: string; intent: 'manage' | 'add' } | null;
  onAccountIntentConsumed?: () => void;
  onManageAccounts?: (harnessId: string, intent: 'manage' | 'add') => void;
  onCloseChatHistory: () => void;
  showUsage: boolean;
  /** False until persisted harness preferences have loaded; the control is disabled meanwhile. */
  usageReady: boolean;
  onUsageOpenChange: (open: boolean) => void;
  usage: UseHarnessUsageResult;
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
  onOpenKeyboardShortcuts: () => void;
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
  handleSetHarnessUsageVisible: (harnessId: string, visible: boolean) => Promise<void>;
  handleSetHarnessAgentBridge?: (harnessId: string, enabled: boolean) => Promise<void>;
  handleSetDefaultModel: (harnessId: string, modelId: string) => Promise<void>;
  handleToggleFavorite: (harnessId: string, modelId: string) => Promise<void>;
}

export default function HeaderRightControls({
  capabilities,
  panelToggles,
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
  environmentId,
  accountIntent,
  onAccountIntentConsumed,
  onManageAccounts,
  onCloseChatHistory,
  showUsage,
  usageReady,
  onUsageOpenChange,
  usage,
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
  onOpenKeyboardShortcuts,
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
  handleSetHarnessUsageVisible,
  handleSetHarnessAgentBridge,
  handleSetDefaultModel,
  handleToggleFavorite,
}: HeaderRightControlsProps) {
  const usageHandoff = useRef(false);
  return (
    <div className="header-right">
      {panelToggles && (
        <>
          {panelToggles}
          <span className="toolbar-divider" aria-hidden="true" />
        </>
      )}
      {capabilities.layout && (<>
      <IconButton
        size="xs"
        variant="ghost"
        className="header-btn header-btn-icon toolbar-btn"
        type="button"
        onClick={undoLayout}
        disabled={!canUndoLayout}
        title="Undo last layout change"
        aria-label="Undo layout change"
      >
        <Undo2 size={14} strokeWidth={2} />
      </IconButton>
      <IconButton
        size="xs"
        variant="ghost"
        className="header-btn header-btn-icon toolbar-btn"
        type="button"
        onClick={fitAllPanes}
        title="Fit all panes into view"
        aria-label="Fit all panes"
      >
        <LayoutGrid size={14} strokeWidth={2} />
      </IconButton>
      </>)}
      {capabilities.recipes && onOpenRecipes && (
        <IconButton
          size="xs"
          variant="ghost"
          className="header-btn header-btn-icon toolbar-btn"
          type="button"
          onClick={onOpenRecipes}
          title="Workspace Launch Recipes"
          aria-label="Workspace Launch Recipes"
        >
          <ScrollText size={14} strokeWidth={2} />
        </IconButton>
      )}
      {(capabilities.sessionHistory || capabilities.usage) && <span className="toolbar-divider" aria-hidden="true" />}
      {capabilities.sessionHistory && (
      <Popover open={showChatHistory} onOpenChange={onChatHistoryOpenChange}>
        <PopoverTrigger asChild>
          <IconButton
            size="xs"
            variant="ghost"
            className={`header-btn toolbar-btn header-btn-icon ${showChatHistory ? 'active' : ''}`}
            title="Chat history"
            aria-label="Chat history"
          >
            <MessageSquare size={14} strokeWidth={2} />
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
      )}
      {capabilities.usage && (
      <Popover open={showUsage} onOpenChange={onUsageOpenChange}>
        <PopoverTrigger asChild>
          <IconButton size="xs" variant="ghost" className={`header-btn toolbar-btn header-btn-icon ${showUsage ? 'active' : ''}`} aria-label="Usage" title="Usage" disabled={!usageReady && !showUsage}>
            <Gauge size={14} strokeWidth={2} />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="usage-popover" aria-label="Usage" workspaceId={workspaceId ?? undefined}
          onCloseAutoFocus={(event) => {
            // On a Usage -> Settings handoff, restoring focus to the Usage trigger would count as an
            // outside interaction and dismiss the Settings popover that is opening.
            if (usageHandoff.current) { event.preventDefault(); usageHandoff.current = false; }
          }}>
          <UsageDropdown
            harnessIds={usage.harnessIds}
            entries={usage.entries}
            otherAccounts={usage.otherAccounts}
            onSelectAccount={usage.selectAccount}
            onManageAccounts={onManageAccounts && ((harnessId, intent) => { usageHandoff.current = true; onManageAccounts(harnessId, intent); })}
            pending={usage.pending}
            refreshing={usage.refreshing}
            now={usage.now}
            canRefresh={usage.canManualRefresh}
            nextManualRefreshAt={usage.nextManualRefreshAt}
            onRefresh={() => usage.refreshAll(true)}
          />
        </PopoverContent>
      </Popover>
      )}
      <Popover open={showSettings} onOpenChange={onSettingsOpenChange}>
        <PopoverTrigger asChild>
          <IconButton ref={settingsTriggerRef} size="xs" variant="ghost" className={`header-btn toolbar-btn header-btn-icon ${showSettings ? 'active' : ''}`} aria-label="Settings" title="Settings">
            <Settings size={14} strokeWidth={2} />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="settings-dropdown" aria-label="Settings"
          workspaceId={workspaceId ?? undefined} onCloseAutoFocus={onSettingsCloseAutoFocus}>
          <AppearanceSettings />
          <AssistantsSettings />
          <div className="settings-section">
            <div className="settings-section-title">Git</div>
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
                disabled={!aiCommitEnabled || isLoadingAiCommitModels}
              >
                {isLoadingAiCommitModels ? (
                  <option value="">Loading models…</option>
                ) : (
                  <>
                    <option value="">Harness default</option>
                    {aiCommitModel && !aiCommitModels.some((model) => model.id === aiCommitModel) && (
                      <option value={aiCommitModel}>{aiCommitModel} (not in catalog)</option>
                    )}
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
          <div className="settings-section settings-links">
            <Button type="button" size="xs" variant="ghost" className="settings-dropdown-action" onClick={onOpenCredentialModal}>
              <KeyRound size={13} strokeWidth={2} aria-hidden="true" />
              <span>Manage VCS credentials</span>
              <ChevronRight className="settings-dropdown-action-chevron" size={13} strokeWidth={2} aria-hidden="true" />
            </Button>
            <Button type="button" size="xs" variant="ghost" className="settings-dropdown-action" onClick={onOpenKeyboardShortcuts}>
              <Keyboard size={13} strokeWidth={2} aria-hidden="true" />
              <span>Keyboard shortcuts</span>
              <ChevronRight className="settings-dropdown-action-chevron" size={13} strokeWidth={2} aria-hidden="true" />
            </Button>
          </div>

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
              handleSetHarnessUsageVisible={handleSetHarnessUsageVisible}
              handleSetHarnessAgentBridge={handleSetHarnessAgentBridge}
              handleSetDefaultModel={handleSetDefaultModel}
              handleToggleFavorite={handleToggleFavorite}
              accountEnvironmentId={environmentId}
              accountIntent={accountIntent}
              onAccountIntentConsumed={onAccountIntentConsumed}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
