import { useEffect, useRef, useState } from 'react';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import { Globe, NotebookPen, PanelLeft, PanelLeftClose } from 'lucide-react';
import { HARNESS_OPTIONS } from '../lib/harnessOptions';
import type { HarnessSession } from '../../shared/types/session';
import GitButton from './GitButton';
import CredentialSettings from './settings/CredentialSettings';
import HeaderRightControls from './HeaderRightControls';
import { useHeaderSettings } from './useHeaderSettings';
import './Header.css';
import type { WorkspaceRecipe } from '../../shared/types/recipes';
import { captureTerminalLaunches } from '../lib/recipeCapture';
import RecipeModal from './RecipeModal';
import { executeWorkspaceRecipe } from '../lib/recipeExecution';
import { serializeWorkspaceLayout } from '../lib/workspaceLayoutStorage';

export default function Header() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const focusedWorkspace = useWorkspaceStore((state) => selectFocusedWorkspace(state));
  const setExplorerVisible = useWorkspaceStore((state) => state.setExplorerVisible);
  const toggleBrowser = useWorkspaceStore((state) => state.toggleBrowser);
  const toggleNotesPane = useWorkspaceStore((state) => state.toggleNotesPane);
  const addTerminal = useWorkspaceStore((state) => state.addTerminal);
  const fitAllPanes = useWorkspaceStore((state) => state.fitAllPanes);
  const undoLayout = useWorkspaceStore((state) => state.undoLayout);
  const setHarness = useWorkspaceStore((state) => state.setHarness);

  const workspacePath = focusedWorkspace?.workspacePath ?? '';
  const browserVisible = focusedWorkspace?.browserVisible ?? false;
  const notesVisible = focusedWorkspace?.notesVisible ?? false;
  const explorerVisible = focusedWorkspace?.explorerVisible ?? false;
  const harness = focusedWorkspace?.harness ?? '';
  const model = focusedWorkspace?.model ?? '';
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [chatSessions, setChatSessions] = useState<HarnessSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionDiscoveryError, setSessionDiscoveryError] = useState('');
  const sessionRequest = useRef(0);
  useEffect(() => {
    sessionRequest.current++;
    setShowChatHistory(false);
    setChatSessions([]);
    setSessionDiscoveryError('');
    setIsLoadingSessions(false);
  }, [focusedWorkspace?.id]);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const credentialHandoff = useRef(false);
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
    handleSetDefaultModel,
    handleToggleFavorite,
    loadHarnessModels,
    aiCommitProviderOptions,
  } = useHeaderSettings({ harness, setHarness, environmentId: focusedWorkspace?.environmentId });

  const handleAddTerminal = async (harnessId: string) => {
    try {
      const resolvedHarness = harnessId && visibleHarnessIds.includes(harnessId)
        ? harnessId
        : undefined;
      const resolvedModel = focusedWorkspace?.environmentId && focusedWorkspace.environmentId !== 'local'
        ? undefined
        : resolvedHarness === harness ? (model || undefined) : undefined;

      const info = focusedWorkspace?.environmentId && focusedWorkspace.environmentId !== 'local'
        ? await window.electronAPI.spawnTerminal(
          workspacePath || '/', resolvedHarness, resolvedModel, undefined, undefined,
          focusedWorkspace.id, focusedWorkspace.environmentId,
        )
        : await window.electronAPI.spawnTerminal(workspacePath || '/', resolvedHarness, resolvedModel);
      addTerminal({
        id: info.id,
        pid: info.pid,
        workingDir: workspacePath,
        harnessId: info.harnessId ?? resolvedHarness ?? null,
        attentionEnabled: info.attentionEnabled === true,
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

  const handleChatHistoryOpenChange = async (open: boolean) => {
    const request = ++sessionRequest.current;
    setShowChatHistory(open);
    if (!open) return;
    setShowSettings(false);
    setIsLoadingSessions(true);
    setSessionDiscoveryError('');
    setChatSessions([]);
    try {
      const sessions = focusedWorkspace?.id
        ? await window.electronAPI.discoverSessions(focusedWorkspace.id)
        : [];
      if (sessionRequest.current === request) setChatSessions(sessions);
    } catch (err) {
      console.error('Failed to discover sessions:', err);
      if (sessionRequest.current === request) setSessionDiscoveryError(err instanceof Error ? err.message : 'Could not discover sessions');
    } finally {
      if (sessionRequest.current === request) setIsLoadingSessions(false);
    }
  };
  const handleSettingsOpenChange = (open: boolean) => {
    setShowSettings(open);
    if (open) void handleChatHistoryOpenChange(false);
  };

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
        if (!browserVisible) toggleBrowser();
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

  const defaultLayout = focusedWorkspace ? serializeWorkspaceLayout(focusedWorkspace) : undefined;
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
                <IconComponent size={14} strokeWidth={2.5} />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>

        <button type="button" className={`header-btn ${browserVisible ? 'active' : ''}`} onClick={handleToggleBrowser} title="Toggle browser panel">
          <Globe size={15} strokeWidth={2} />
          Browser
        </button>

        <button type="button" className={`header-btn ${notesVisible ? 'active' : ''}`} onClick={handleToggleNotes} title="Toggle notes panel">
          <NotebookPen size={15} strokeWidth={2} />
          Notes
        </button>

        {workspacePath && (
          <GitButton key={focusedWorkspace?.id} workspacePath={workspacePath} workspaceId={focusedWorkspace?.id} />
        )}
      </div>

      <HeaderRightControls
        fitAllPanes={fitAllPanes}
        undoLayout={() => undoLayout(activeWorkspaceId ?? undefined)}
        canUndoLayout={(focusedWorkspace?.layoutUndoStack?.length ?? 0) > 0}
        onOpenRecipes={handleOpenRecipes}
        showChatHistory={showChatHistory}
        onChatHistoryOpenChange={(open) => void handleChatHistoryOpenChange(open)}
        chatSessions={chatSessions}
        isLoadingSessions={isLoadingSessions}
        sessionDiscoveryError={sessionDiscoveryError}
        workspacePath={workspacePath || '/'}
        workspaceId={focusedWorkspace?.id ?? null}
        onCloseChatHistory={() => void handleChatHistoryOpenChange(false)}
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
      <CredentialSettings
        isOpen={showCredentialModal}
        onClose={() => setShowCredentialModal(false)}
        workspacePath={workspacePath || undefined}
        onOpenAutoFocus={() => {
          // Dialog content has acquired its lease before autofocus. Keep the
          // outgoing Popover mounted until then so the browser never reappears.
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
