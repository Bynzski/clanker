import { IconButton } from './ui/IconButton';
import { useEffect, useRef, useState } from 'react';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspaceNavigationStore } from '../store/workspaceNavigationStore';
import { isExplorerShown, toggleFocusedWorkspaceExplorer } from '../lib/explorerToggle';
import { Code, Globe, NotebookPen, PanelLeft, PanelLeftClose } from 'lucide-react';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';
import GitButton from './GitButton';
import IsolatedAgentButton from './IsolatedAgentButton';
import CredentialSettings from './settings/CredentialSettings';
import type { SettingsPage } from './settings/SettingsManagement';
import { registerOpenSettingsHandler } from '../lib/keybindingDispatcher';
import { registerManageAccountsHandler } from '../lib/settingsHandoff';
import HeaderRightControls from './HeaderRightControls';
import { useHeaderSettings } from './useHeaderSettings';
import { useConversationHistory } from './useConversationHistory';
import './Header.css';
import type { WorkspaceRecipe } from '../../shared/types/recipes';
import { paneIsPresented, workspaceBrowserPresented } from '../store/workspacePages';
import { captureTerminalLaunches } from '../lib/recipeCapture';
import RecipeModal from './RecipeModal';
import { executeWorkspaceRecipe } from '../lib/recipeExecution';
import { serializeWorkspaceLayout } from '../lib/workspaceLayoutStorage';
import { resolveToolbarLaunch } from '../lib/toolbarLaunch';
import { launchWorkspaceTerminal } from '../lib/workspaceTerminalLaunch';
import { resolveDestinationCapabilities, useActiveDestination } from '../lib/activeDestination';
import { useAssistantSurfaceStore } from '../store/assistantSurfaceStore';

interface HeaderProps {
  /** `bar` is the standalone toolbar row (tabs mode); `titlebar` docks it into the title bar (sidebar mode). */
  placement?: 'bar' | 'titlebar';
}

export default function Header({ placement = 'bar' }: HeaderProps) {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const focusedWorkspace = useWorkspaceStore((state) => selectFocusedWorkspace(state));
  const toggleBrowser = useWorkspaceStore((state) => state.toggleBrowser);
  const toggleNotesPane = useWorkspaceStore((state) => state.toggleNotesPane);
  const toggleEditorPane = useWorkspaceStore((state) => state.toggleEditorPane);
  const addTerminal = useWorkspaceStore((state) => state.addTerminal);
  const fitAllPanes = useWorkspaceStore((state) => state.fitAllPanes);
  const undoLayout = useWorkspaceStore((state) => state.undoLayout);
  const setHarness = useWorkspaceStore((state) => state.setHarness);

  // Controls act on the ACTIVE destination: a warm workspace in the background is never a target.
  const destination = useActiveDestination();
  const capabilities = resolveDestinationCapabilities(destination);
  const activeAssistantId = destination.kind === 'assistant' ? destination.assistantId : null;
  const assistantBrowserVisible = useAssistantSurfaceStore((state) => (activeAssistantId ? state.byId[activeAssistantId]?.browserVisible ?? false : false));
  const toggleAssistantBrowser = useAssistantSurfaceStore((state) => state.toggleBrowser);
  const workspacePath = focusedWorkspace?.workspacePath ?? '';
  const browserVisible = activeAssistantId ? assistantBrowserVisible : focusedWorkspace ? workspaceBrowserPresented(focusedWorkspace) : false;
  const notesVisible = Boolean(focusedWorkspace?.notesVisible && (!focusedWorkspace.pages || (focusedWorkspace.notesPane && paneIsPresented(focusedWorkspace, focusedWorkspace.notesPane.id))));
  const editorVisible = Boolean(focusedWorkspace?.editorVisible && (!focusedWorkspace.pages || (focusedWorkspace.editorPane && paneIsPresented(focusedWorkspace, focusedWorkspace.editorPane.id))));
  const explorerVisible = focusedWorkspace?.explorerVisible ?? false;
  const sidebarMode = useWorkspaceNavigationStore((state) => state.mode === 'sidebar');
  const explorerShown = useWorkspaceNavigationStore((state) => isExplorerShown(explorerVisible, state.mode, state.sidebarWidth));
  const harness = focusedWorkspace?.harness ?? '';
  const model = focusedWorkspace?.model ?? '';
  const [showChatHistory, setShowChatHistory] = useState(false);
  // Background warm-ups are local-only: they must never trigger unattended SSH probes or scans.
  const warmupEnabled = !focusedWorkspace?.environmentId || focusedWorkspace.environmentId === 'local';
  const history = useConversationHistory(focusedWorkspace?.id ?? null, { warmup: warmupEnabled });
  // The focused workspace's own environment scopes account management; local only when there is none.
  const accountEnvironmentId = focusedWorkspace?.environmentId || 'local';
  const [accountIntent, setAccountIntent] = useState<{ harness: string; intent: 'manage' | 'add' } | null>(null);
  // A workspace change closes the workspace-scoped panels (reset during render; history voids its own answers).
  const [panelOwner, setPanelOwner] = useState(focusedWorkspace?.id);
  if (panelOwner !== focusedWorkspace?.id) {
    setPanelOwner(focusedWorkspace?.id);
    setAccountIntent(null);
    setShowChatHistory(false);
  }
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const credentialHandoff = useRef(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('appearance');
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [activeRecipe, setActiveRecipe] = useState<WorkspaceRecipe | null>(null);
  const {
    availableHarnessIds,
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
    visibleHarnessIds,
    expandedHarness,
    setExpandedHarness,
    harnessModelCache,
    harnessModelLoading,
    handleToggleAiCommit,
    handleAiCommitProviderChange,
    handleAiCommitModelChange,
    handleSetHarnessFlags,
    handleSetHarnessVisible,
    handleSetHarnessAttention,
    handleSetHarnessUsageVisible,
    handleSetHarnessAgentBridge,
    handleSetDefaultModel,
    handleToggleFavorite,
    loadHarnessModels,
    aiCommitProviderOptions,
  } = useHeaderSettings({ harness, setHarness, environmentId: focusedWorkspace?.environmentId });
  const handleAddTerminal = async (harnessId: string) => {
    if (!focusedWorkspace || !workspacePath || destination.kind !== 'workspace') return;
    try {
      const { harness: resolvedHarness, model: resolvedModel } = resolveToolbarLaunch({
        harnessId,
        visibleHarnessIds,
        workspaceHarness: harness,
        workspaceModel: model,
        environmentId: focusedWorkspace?.environmentId,
      });

      await launchWorkspaceTerminal(focusedWorkspace, workspacePath, {
        harness: resolvedHarness,
        model: resolvedModel,
        pageId: focusedWorkspace.activePageId,
      });
    } catch (err) {
      console.error('Failed to spawn terminal:', err);
    }
  };

  const handleToggleBrowser = () => {
    if (activeAssistantId) toggleAssistantBrowser(activeAssistantId);
    else toggleBrowser();
  };

  const handleToggleNotes = () => {
    toggleNotesPane();
  };

  const handleChatHistoryOpenChange = (open: boolean) => {
    setShowChatHistory(open);
    history.setOpen(open);
    if (!open) return;
    setShowSettings(false);
  };
  const handleSettingsOpenChange = (open: boolean) => {
    setShowSettings(open);
    if (open) {
      setSettingsPage('appearance');
      handleChatHistoryOpenChange(false);
    }
  };
  // The app keybinding dispatcher opens Settings through this same state path.
  useEffect(() => registerOpenSettingsHandler(() => handleSettingsOpenChange(true)));
  /** Usage widget -> Settings handoff: open Settings, expand that harness; its account row does the rest. */
  const handleManageAccounts = (harnessId: string, intent: 'manage' | 'add') => {
    handleChatHistoryOpenChange(false);
    setSettingsPage('legacy');
    setAccountIntent({ harness: harnessId, intent });
    setExpandedHarness(harnessId);
    void loadHarnessModels(harnessId);
    setShowSettings(true);
  };
  useEffect(() => registerManageAccountsHandler(handleManageAccounts));

  const handleOpenRecipes = async () => {
    if (focusedWorkspace?.environmentId && focusedWorkspace.environmentId !== 'local') {
      setActiveRecipe(null);
      setShowRecipeModal(true);
      return;
    }
    try {
      if (typeof window.electronAPI?.recipeGetAll === 'function') {
        const recipes = await window.electronAPI.recipeGetAll(workspacePath);
        if (recipes.length > 0) {
          setActiveRecipe(recipes[0]);
        } else {
          setActiveRecipe(null);
        }
      }
    } catch {
      setActiveRecipe(null);
    }
    setShowRecipeModal(true);
  };

  const handleLaunchRecipe = async (recipe: WorkspaceRecipe) => {
    return executeWorkspaceRecipe(recipe, {
      ensureWorkspaceOpen: async () => activeWorkspaceId,
      spawnTerminal: window.electronAPI.spawnTerminal,
      waitRecipeCommand: window.electronAPI.waitRecipeCommand,
      probePreview: window.electronAPI.probeRecipePreview,
      onTerminalSpawned: (_wsId, term) => {
        addTerminal(term);
      },
      openBrowserPreview: async (wsId, url) => {
        const store = useWorkspaceStore.getState();
        const target = store.workspaces.find((entry) => entry.id === wsId);
        if (target && !target.browserVisible) {
          store.setBrowserVisible(true, wsId);
        }
        if (typeof window.electronAPI?.browserNavigate === 'function') {
          return window.electronAPI.browserNavigate(wsId, url, undefined, true);
        }
        return false;
      },
      restoreLayout: (wsId, layout) => {
        useWorkspaceStore.getState().applyPersistedLayout(layout, wsId);
      },
      getExistingTerminalCount: (wsId) => {
        return useWorkspaceStore.getState().workspaces.find((w) => w.id === wsId)?.terminals.length ?? 0;
      },
    });
  };

  const defaultLaunches = captureTerminalLaunches(focusedWorkspace?.terminals ?? []);

  // Panel toggles sit with the other view controls on the right. Sidebar mode has
  // no Explorer toggle here: FILES is pinned to the bottom of the sidebar instead.
  const panelToggles = (
    <div className="toolbar-group" role="group" aria-label="Panels">
      {!sidebarMode && capabilities.explorer && (
        <IconButton
          type="button"
          size="xs"
          variant="ghost"
          className={`header-btn header-btn-icon toolbar-btn ${explorerShown ? 'active' : ''}`}
          onClick={toggleFocusedWorkspaceExplorer}
          aria-pressed={explorerShown}
          aria-label="Toggle File Explorer"
          title="Toggle File Explorer"
        >
          {explorerShown ? <PanelLeftClose size={14} strokeWidth={2} /> : <PanelLeft size={14} strokeWidth={2} />}
        </IconButton>
      )}
      {capabilities.browser && (
        <IconButton
          type="button"
          size="xs"
          variant="ghost"
          className={`header-btn header-btn-icon toolbar-btn ${browserVisible ? 'active' : ''}`}
          onClick={handleToggleBrowser}
          aria-pressed={browserVisible}
          aria-label="Toggle browser panel"
          title="Toggle browser panel"
        >
          <Globe size={14} strokeWidth={2} />
        </IconButton>
      )}
      {capabilities.notes && (
        <IconButton
          type="button"
          size="xs"
          variant="ghost"
          className={`header-btn header-btn-icon toolbar-btn ${notesVisible ? 'active' : ''}`}
          onClick={handleToggleNotes}
          aria-pressed={notesVisible}
          aria-label="Toggle notes panel"
          title="Toggle notes panel"
        >
          <NotebookPen size={14} strokeWidth={2} />
        </IconButton>
      )}
      {capabilities.explorer && focusedWorkspace && (
        (focusedWorkspace.editorTabs?.length ?? 0) > 0 ||
        Boolean(focusedWorkspace.editorPane && (
          focusedWorkspace.editorVisible ||
          focusedWorkspace.minimizedPanes?.some((entry) => entry.paneId === focusedWorkspace.editorPane?.id)
        ))
      ) && (
        <IconButton
          type="button"
          size="xs"
          variant="ghost"
          className={`header-btn header-btn-icon toolbar-btn ${editorVisible ? 'active' : ''}`}
          onClick={() => toggleEditorPane()}
          aria-pressed={editorVisible}
          aria-label="Toggle editor panel"
          title="Toggle editor panel"
        >
          <Code size={14} strokeWidth={2} />
        </IconButton>
      )}
    </div>
  );

  const defaultLayout = focusedWorkspace ? serializeWorkspaceLayout(focusedWorkspace) : undefined;
  return (
    <header className={`header${placement === 'titlebar' ? ' header-inline' : ''}`} data-placement={placement}>
      <div className="header-center">
        {capabilities.terminalLaunch && <div className="harness-pills" role="group" aria-label="New terminal">
          {HARNESS_OPTIONS.filter((opt) => visibleHarnessIds.includes(opt.id)).map(opt => {
            const IconComponent = opt.Icon;
            return (
              <button
                key={opt.id}
                type="button"
                className="harness-pill"
                onClick={() => void handleAddTerminal(opt.id)}
                title={opt.id ? `Add ${opt.label} terminal` : 'Add terminal'}
              >
                <IconComponent size={14} strokeWidth={2.25} />
                <span className="harness-pill-label">{opt.label}</span>
              </button>
            );
          })}
        </div>}
        {capabilities.isolatedAgent && focusedWorkspace && !focusedWorkspace.isLinkedWorktree && (
          <>
            {/* Set apart from the harness launchers: this creates a worktree-backed agent, it is not another harness. */}
            <span className="toolbar-divider" aria-hidden="true" />
            <IsolatedAgentButton key={focusedWorkspace.id} workspace={focusedWorkspace} visibleHarnessIds={visibleHarnessIds} />
          </>
        )}

        {capabilities.git && workspacePath && (
          <>
            <span className="toolbar-divider" aria-hidden="true" />
            <GitButton key={focusedWorkspace?.id} workspacePath={workspacePath} workspaceId={focusedWorkspace?.id} />
          </>
        )}
      </div>

      <HeaderRightControls
        capabilities={capabilities}
        panelToggles={panelToggles}
        fitAllPanes={fitAllPanes}
        undoLayout={() => undoLayout(activeWorkspaceId ?? undefined)}
        canUndoLayout={(focusedWorkspace?.layoutUndoStack?.length ?? 0) > 0}
        onOpenRecipes={handleOpenRecipes}
        showChatHistory={showChatHistory}
        onChatHistoryOpenChange={(open) => handleChatHistoryOpenChange(open)}
        chatSessions={history.sessions}
        isLoadingSessions={history.isLoading}
        sessionDiscoveryError={history.error}
        workspacePath={workspacePath || '/'}
        workspaceId={focusedWorkspace?.id ?? null}
        environmentId={accountEnvironmentId}
        accountIntent={accountIntent}
        onAccountIntentConsumed={() => setAccountIntent(null)}
        onCloseChatHistory={() => handleChatHistoryOpenChange(false)}
        settingsTriggerRef={settingsTriggerRef}
        onSettingsCloseAutoFocus={(event) => {
          if (credentialHandoff.current) event.preventDefault();
        }}
        showSettings={showSettings}
        onSettingsOpenChange={handleSettingsOpenChange}
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
          credentialHandoff.current = true;
          setShowCredentialModal(true);
        }}
        settingsPage={settingsPage}
        onSettingsPageChange={setSettingsPage}
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
      />
      <CredentialSettings
        isOpen={showCredentialModal}
        onClose={() => setShowCredentialModal(false)}
        workspacePath={workspacePath || undefined}
        onOpenAutoFocus={() => {
          // Keep the outgoing Settings dialog until Credentials holds its lease.
          setShowSettings(false);
        }}
        onCloseAutoFocus={(event) => {
          if (credentialHandoff.current) {
            event.preventDefault();
            settingsTriggerRef.current?.focus();
            credentialHandoff.current = false;
          }
        }}
      />
      <RecipeModal
        isOpen={showRecipeModal}
        onClose={() => setShowRecipeModal(false)}
        initialRecipe={activeRecipe}
        defaultWorkspacePath={workspacePath}
        workspaceEnvironmentId={focusedWorkspace?.environmentId}
        defaultLaunches={defaultLaunches}
        defaultBrowserUrl={browserVisible ? focusedWorkspace?.browserUrl : undefined}
        defaultLayout={defaultLayout ?? undefined}
        defaultTerminalCount={focusedWorkspace?.panes.length ?? 1}
        onLaunchRecipe={handleLaunchRecipe}
        onRecipeSaved={(saved) => setActiveRecipe(saved)}
        onRecipeDeleted={() => setActiveRecipe(null)}
      />
    </header>
  );
}
