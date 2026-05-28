import { useRef, useState } from 'react';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import { Plus, Globe, NotebookPen, PanelLeft, PanelLeftClose } from 'lucide-react';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';
import type { HarnessSession } from '../../shared/types/session';
import GitButton from './GitButton';
import CredentialSettings from './settings/CredentialSettings';
import HeaderRightControls from './HeaderRightControls';
import { useBrowserOverlayWhileOpen, useCloseOnOutsidePointerAndEscape } from './useDropdownBehavior';
import { useHeaderSettings } from './useHeaderSettings';
import './Header.css';

export default function Header() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const focusedWorkspace = useWorkspaceStore((state) => selectFocusedWorkspace(state));
  const setExplorerVisible = useWorkspaceStore((state) => state.setExplorerVisible);
  const toggleBrowser = useWorkspaceStore((state) => state.toggleBrowser);
  const toggleNotesPane = useWorkspaceStore((state) => state.toggleNotesPane);
  const addTerminal = useWorkspaceStore((state) => state.addTerminal);
  const fitAllPanes = useWorkspaceStore((state) => state.fitAllPanes);
  const setHarness = useWorkspaceStore((state) => state.setHarness);
  const pushBrowserOverlay = useWorkspaceStore((state) => state.pushBrowserOverlay);
  const popBrowserOverlay = useWorkspaceStore((state) => state.popBrowserOverlay);

  const workspacePath = focusedWorkspace?.workspacePath ?? '';
  const browserVisible = focusedWorkspace?.browserVisible ?? false;
  const notesVisible = focusedWorkspace?.notesVisible ?? false;
  const explorerVisible = focusedWorkspace?.explorerVisible ?? false;
  const harness = focusedWorkspace?.harness ?? '';
  const model = focusedWorkspace?.model ?? '';
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [chatSessions, setChatSessions] = useState<HarnessSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const chatDropdownRef = useRef<HTMLDivElement>(null);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);

  const {
    availableHarnessIds,
    showFastfetch,
    showSettings,
    setShowSettings,
    showCredentialModal,
    setShowCredentialModal,
    aiCommitEnabled,
    aiCommitProvider,
    aiCommitModel,
    aiCommitModels,
    isLoadingAiCommitModels,
    harnessDefaults,
    expandedHarness,
    setExpandedHarness,
    harnessModelCache,
    harnessModelLoading,
    handleToggleFastfetch,
    handleToggleAiCommit,
    handleAiCommitProviderChange,
    handleAiCommitModelChange,
    handleSetHarnessFlags,
    handleSetDefaultModel,
    handleToggleFavorite,
    loadHarnessModels,
    aiCommitProviderOptions,
  } = useHeaderSettings({ harness, setHarness });

  useBrowserOverlayWhileOpen(showSettings, activeWorkspaceId, pushBrowserOverlay, popBrowserOverlay);
  useCloseOnOutsidePointerAndEscape(showSettings, settingsDropdownRef, () => setShowSettings(false));

  useBrowserOverlayWhileOpen(showChatHistory, activeWorkspaceId, pushBrowserOverlay, popBrowserOverlay);
  useCloseOnOutsidePointerAndEscape(showChatHistory, chatDropdownRef, () => setShowChatHistory(false));

  const handleAddTerminal = async () => {
    try {
      // Priority 1: workspace harness + model (highest priority)
      const workspaceHarness = availableHarnessIds.includes(harness) ? harness : '';
      const workspaceModel = workspaceHarness ? (model || undefined) : undefined;

      // Priority 2: no workspace harness → plain shell.
      // Global defaults do not infer a harness when workspace has none set.
      // (Flags are read from store by the main process at spawn time.)
      const resolvedHarness = workspaceHarness || undefined;
      const resolvedModel = workspaceModel;

      const info = await window.electronAPI.spawnTerminal(
        workspacePath || '/',
        resolvedHarness,
        resolvedModel,
      );
      addTerminal({
        id: info.id,
        pid: info.pid,
        workingDir: workspacePath,
      });
    } catch (err) {
      console.error('Failed to spawn terminal:', err);
    }
  };

  const handleToggleBrowser = () => {
    toggleBrowser();
  };

  const handleToggleNotes = () => {
    toggleNotesPane();
  };

  const handleToggleChatHistory = async () => {
    if (showChatHistory) {
      setShowChatHistory(false);
      return;
    }
    setShowChatHistory(true);
    setIsLoadingSessions(true);
    try {
      const sessions = await window.electronAPI.discoverSessions(workspacePath || '/');
      setChatSessions(sessions);
    } catch (err) {
      console.error('Failed to discover sessions:', err);
      setChatSessions([]);
    } finally {
      setIsLoadingSessions(false);
    }
  };

  return (
    <header className="header">
      <div className="header-center">
        <button
          type="button"
          className={`header-btn ${explorerVisible ? 'active' : ''}`}
          onClick={() => setExplorerVisible(!explorerVisible)}
          title="Toggle File Explorer"
        >
          {explorerVisible ? <PanelLeftClose size={15} strokeWidth={2} /> : <PanelLeft size={15} strokeWidth={2} />}
          Explorer
        </button>

        <div className="harness-pills">
          {HARNESS_OPTIONS.filter((opt) => availableHarnessIds.includes(opt.id)).map(opt => {
            const IconComponent = opt.Icon;
            return (
              <button
                key={opt.id}
                className={`harness-pill ${harness === opt.id ? 'active' : ''}`}
                onClick={() => setHarness(opt.id)}
                title={opt.label}
              >
                <IconComponent size={14} strokeWidth={2.5} />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>

        <button className="header-btn header-btn-primary" type="button" onClick={handleAddTerminal}>
          <Plus size={15} strokeWidth={2.5} />
          New Terminal
        </button>

        <button type="button" className={`header-btn ${browserVisible ? 'active' : ''}`} onClick={handleToggleBrowser} title="Toggle browser panel">
          <Globe size={15} strokeWidth={2} />
          Browser
        </button>

        <button type="button" className={`header-btn ${notesVisible ? 'active' : ''}`} onClick={handleToggleNotes} title="Toggle notes panel">
          <NotebookPen size={15} strokeWidth={2} />
          Notes
        </button>
        
        {workspacePath && (
          <GitButton workspacePath={workspacePath} />
        )}
      </div>

      <HeaderRightControls
        fitAllPanes={fitAllPanes}
        chatDropdownRef={chatDropdownRef}
        showChatHistory={showChatHistory}
        onToggleChatHistory={() => void handleToggleChatHistory()}
        chatSessions={chatSessions}
        isLoadingSessions={isLoadingSessions}
        workspacePath={workspacePath || '/'}
        onCloseChatHistory={() => setShowChatHistory(false)}
        settingsDropdownRef={settingsDropdownRef}
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings(!showSettings)}
        showFastfetch={showFastfetch}
        onToggleFastfetch={(checked) => void handleToggleFastfetch(checked)}
        aiCommitEnabled={aiCommitEnabled}
        onToggleAiCommit={(checked) => void handleToggleAiCommit(checked)}
        aiCommitProvider={aiCommitProvider}
        aiCommitProviderOptions={aiCommitProviderOptions}
        onAiCommitProviderChange={(provider) => void handleAiCommitProviderChange(provider)}
        aiCommitModel={aiCommitModel}
        aiCommitModels={aiCommitModels}
        isLoadingAiCommitModels={isLoadingAiCommitModels}
        onAiCommitModelChange={(nextModel) => void handleAiCommitModelChange(nextModel)}
        onOpenCredentialModal={() => {
          setShowCredentialModal(true);
          setShowSettings(false);
        }}
        harnessDefaults={harnessDefaults}
        availableHarnessIds={availableHarnessIds}
        expandedHarness={expandedHarness}
        setExpandedHarness={setExpandedHarness}
        harnessModelCache={harnessModelCache}
        harnessModelLoading={harnessModelLoading}
        loadHarnessModels={loadHarnessModels}
        handleSetHarnessFlags={handleSetHarnessFlags}
        handleSetDefaultModel={handleSetDefaultModel}
        handleToggleFavorite={handleToggleFavorite}
      />
      <CredentialSettings
        isOpen={showCredentialModal}
        onClose={() => setShowCredentialModal(false)}
        workspacePath={workspacePath || undefined}
      />
    </header>
  );
}
