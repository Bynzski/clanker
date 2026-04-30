import { ChevronDown, LayoutGrid, MessageSquare, Settings } from 'lucide-react';
import type { HarnessSession } from '../../shared/types/session';
import type { ModelOption } from '../types/shared';
import type { HarnessDefaultsMap } from '../../shared/types/store';
import ChatHistoryDropdown from './ChatHistoryDropdown';
import HarnessDefaultsSection from './settings/HarnessDefaultsSection';

interface HeaderRightControlsProps {
  fitAllPanes: () => void;
  chatDropdownRef: React.RefObject<HTMLDivElement | null>;
  showChatHistory: boolean;
  onToggleChatHistory: () => void;
  chatSessions: HarnessSession[];
  isLoadingSessions: boolean;
  workspacePath: string;
  onCloseChatHistory: () => void;
  settingsDropdownRef: React.RefObject<HTMLDivElement | null>;
  showSettings: boolean;
  onToggleSettings: () => void;
  showFastfetch: boolean;
  onToggleFastfetch: (checked: boolean) => void;
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
  handleToggleHarnessFlag: (harnessId: string, enabled: boolean) => Promise<void>;
  handleSetDefaultModel: (harnessId: string, modelId: string) => Promise<void>;
  handleToggleFavorite: (harnessId: string, modelId: string) => Promise<void>;
}

export default function HeaderRightControls({
  fitAllPanes,
  chatDropdownRef,
  showChatHistory,
  onToggleChatHistory,
  chatSessions,
  isLoadingSessions,
  workspacePath,
  onCloseChatHistory,
  settingsDropdownRef,
  showSettings,
  onToggleSettings,
  showFastfetch,
  onToggleFastfetch,
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
  handleToggleHarnessFlag,
  handleSetDefaultModel,
  handleToggleFavorite,
}: HeaderRightControlsProps) {
  return (
    <div className="header-right">
      <button
        className="header-btn header-btn-icon"
        type="button"
        onClick={fitAllPanes}
        title="Fit all panes into view (Ctrl/Cmd+Shift+F)"
        aria-label="Fit all panes"
      >
        <LayoutGrid size={15} strokeWidth={2} />
      </button>
      <div className="settings-dropdown-container" ref={chatDropdownRef}>
        <button
          className={`header-btn header-btn-icon ${showChatHistory ? 'active' : ''}`}
          type="button"
          onClick={onToggleChatHistory}
          title="Chat history"
          aria-label="Chat history"
        >
          <MessageSquare size={15} strokeWidth={2} />
        </button>
        {showChatHistory && (
          <ChatHistoryDropdown
            sessions={chatSessions}
            isLoading={isLoadingSessions}
            workspacePath={workspacePath || '/'}
            onClose={onCloseChatHistory}
          />
        )}
      </div>
      <div className="settings-dropdown-container" ref={settingsDropdownRef}>
        <button
          className="header-btn"
          type="button"
          onClick={onToggleSettings}
          title="Settings"
        >
          <Settings size={15} strokeWidth={2} />
          <ChevronDown size={12} strokeWidth={2} />
        </button>

        {showSettings && (
          <div className="settings-dropdown">
            <label className="settings-option">
              <input
                type="checkbox"
                checked={showFastfetch}
                onChange={(e) => onToggleFastfetch(e.target.checked)}
              />
              <span>Show fastfetch</span>
            </label>

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
                <select
                  className="settings-select"
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
                </select>
              </div>

              <div className="settings-row">
                <span className="settings-row-label">Model</span>
                <select
                  className="settings-select"
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
                </select>
              </div>
            </div>
            <button type="button" className="settings-dropdown-action" onClick={onOpenCredentialModal}>
              Manage VCS credentials
            </button>

            {harnessDefaults && (
              <HarnessDefaultsSection
                harnessDefaults={harnessDefaults}
                availableHarnessIds={availableHarnessIds}
                expandedHarness={expandedHarness}
                setExpandedHarness={setExpandedHarness}
                harnessModelCache={harnessModelCache}
                harnessModelLoading={harnessModelLoading}
                loadHarnessModels={loadHarnessModels}
                handleToggleHarnessFlag={handleToggleHarnessFlag}
                handleSetDefaultModel={handleSetDefaultModel}
                handleToggleFavorite={handleToggleFavorite}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
