import { useEffect, useRef, useState } from 'react';
import { selectFocusedWorkspace, useWorkspaceStore } from '../store/workspaceStore';
import { Plus, Globe, LayoutGrid, Settings, ChevronDown, PanelLeft, PanelLeftClose, ChevronRight, AlertTriangle, Star, MessageSquare } from 'lucide-react';
import { AI_COMMIT_PROVIDER_IDS, HARNESS_OPTIONS, resolveAvailableHarnessIds } from '../lib/harnessOptions';
import { harnessFlagsFromToggle, harnessToggleFromFlags } from '../lib/harnessFlags';
import type { HarnessDefaultsMap } from '../../shared/types/store';
import { KNOWN_HARNESS_IDS } from '../../shared/harnessIds';
import type { ModelOption } from '../types/shared';
import type { HarnessSession } from '../../shared/types/session';
import GitButton from './GitButton';
import CredentialSettings from './settings/CredentialSettings';
import ChatHistoryDropdown from './ChatHistoryDropdown';
import './Header.css';

export default function Header() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const focusedWorkspace = useWorkspaceStore((state) => selectFocusedWorkspace(state));
  const setExplorerVisible = useWorkspaceStore((state) => state.setExplorerVisible);
  const toggleBrowser = useWorkspaceStore((state) => state.toggleBrowser);
  const addTerminal = useWorkspaceStore((state) => state.addTerminal);
  const fitAllPanes = useWorkspaceStore((state) => state.fitAllPanes);
  const setHarness = useWorkspaceStore((state) => state.setHarness);
  const canAddPane = useWorkspaceStore((state) => state.canAddPane);
  const pushBrowserOverlay = useWorkspaceStore((state) => state.pushBrowserOverlay);
  const popBrowserOverlay = useWorkspaceStore((state) => state.popBrowserOverlay);

  const workspacePath = focusedWorkspace?.workspacePath ?? '';
  const browserVisible = focusedWorkspace?.browserVisible ?? false;
  const explorerVisible = focusedWorkspace?.explorerVisible ?? false;
  const harness = focusedWorkspace?.harness ?? '';
  const model = focusedWorkspace?.model ?? '';
  const [availableHarnessIds, setAvailableHarnessIds] = useState<string[]>(['']);
  const [showFastfetch, setShowFastfetch] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [aiCommitEnabled, setAiCommitEnabled] = useState(false);
  const [aiCommitProvider, setAiCommitProvider] = useState<string>('');
  const [aiCommitModel, setAiCommitModel] = useState('');
  const [aiCommitModels, setAiCommitModels] = useState<ModelOption[]>([]);
  const [isLoadingAiCommitModels, setIsLoadingAiCommitModels] = useState(false);
  const [hasLoadedAiCommitSettings, setHasLoadedAiCommitSettings] = useState(false);
  // Harness defaults settings state
  const [harnessDefaults, setHarnessDefaultsState] = useState<HarnessDefaultsMap | null>(null);
  const [expandedHarness, setExpandedHarness] = useState<string | null>(null);
  // Per-harness model cache: harnessId -> ModelOption[]
  const [harnessModelCache, setHarnessModelCache] = useState<Record<string, ModelOption[]>>({});
  // Per-harness model loading: harnessId -> boolean
  const [harnessModelLoading, setHarnessModelLoading] = useState<Record<string, boolean>>({});
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [chatSessions, setChatSessions] = useState<HarnessSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const chatDropdownRef = useRef<HTMLDivElement>(null);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);

  // Hide the native browser whenever the settings dropdown is open.
  useEffect(() => {
    if (!showSettings) {
      return;
    }

    if (!activeWorkspaceId) {
      return;
    }

    pushBrowserOverlay(activeWorkspaceId);
    return () => popBrowserOverlay(activeWorkspaceId);
  }, [activeWorkspaceId, showSettings, pushBrowserOverlay, popBrowserOverlay]);

  // Close the settings dropdown when clicking outside it.
  useEffect(() => {
    if (!showSettings) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        settingsDropdownRef.current &&
        !settingsDropdownRef.current.contains(event.target as Node)
      ) {
        setShowSettings(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSettings(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showSettings]);

  useEffect(() => {
    if (!showChatHistory) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        chatDropdownRef.current &&
        !chatDropdownRef.current.contains(event.target as Node)
      ) {
        setShowChatHistory(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowChatHistory(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showChatHistory]);

  useEffect(() => {
    let cancelled = false;

    const loadHarnessOptions = async () => {
      try {
        const options = await window.electronAPI.getHarnessOptions();
        if (cancelled) return;

        const availableIds = resolveAvailableHarnessIds(options);

        setAvailableHarnessIds(availableIds);
      } catch {
        if (!cancelled) {
          setAvailableHarnessIds(['']);
        }
      }
    };

    loadHarnessOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (harness && !availableHarnessIds.includes(harness)) {
      setHarness('');
    }
  }, [harness, availableHarnessIds, setHarness]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const show = await window.electronAPI.getShowFastfetch();
        setShowFastfetch(show);
      } catch (err) {
        console.error('Failed to load fastfetch setting:', err);
      }

      try {
        const aiCommitSettings = await window.electronAPI.getAiCommitSettings();
        setAiCommitEnabled(aiCommitSettings.enabled);
        setAiCommitProvider(aiCommitSettings.provider);
        setAiCommitModel(aiCommitSettings.model);
      } catch (err) {
        console.error('Failed to load AI commit settings:', err);
      } finally {
        setHasLoadedAiCommitSettings(true);
      }
    };
    loadSettings();
  }, []);

  // Load harness defaults from electron-store on mount
  useEffect(() => {
    const loadHarnessDefaults = async () => {
      try {
        const defaults = await window.electronAPI.getHarnessDefaults();
        setHarnessDefaultsState(defaults);
      } catch (err) {
        console.error('Failed to load harness defaults:', err);
      }
    };
    loadHarnessDefaults();
  }, []);

  useEffect(() => {
    if (!hasLoadedAiCommitSettings) {
      return;
    }

    const availableProviders = HARNESS_OPTIONS
      .filter((option) => option.id !== '' && AI_COMMIT_PROVIDER_IDS.includes(option.id as typeof AI_COMMIT_PROVIDER_IDS[number]))
      .map((option) => option.id)
      .filter((id) => availableHarnessIds.includes(id));

    if (availableProviders.length === 0) {
      return;
    }

    if (!aiCommitProvider || !availableProviders.includes(aiCommitProvider)) {
      const nextProvider = availableProviders[0];
      setAiCommitProvider(nextProvider);
      void window.electronAPI.setAiCommitProvider(nextProvider);
      setAiCommitModel('');
      void window.electronAPI.setAiCommitModel('');
    }
  }, [availableHarnessIds, aiCommitProvider, hasLoadedAiCommitSettings]);

  useEffect(() => {
    if (!hasLoadedAiCommitSettings) {
      return;
    }

    let cancelled = false;

    const loadAiCommitModels = async () => {
      if (!aiCommitProvider || !availableHarnessIds.includes(aiCommitProvider)) {
        setAiCommitModels([]);
        return;
      }

      setIsLoadingAiCommitModels(true);
      try {
        const models = await window.electronAPI.getHarnessModels(aiCommitProvider);
        if (cancelled) return;

        setAiCommitModels(models);
        setAiCommitModel((current) => {
          if (models.some((model) => model.id === current)) {
            return current;
          }

          const nextModel = models[0]?.id ?? '';
          if (nextModel !== current) {
            void window.electronAPI.setAiCommitModel(nextModel);
          }
          return nextModel;
        });
      } catch (error) {
        console.error('Failed to load AI commit models:', error);
        if (!cancelled) {
          setAiCommitModels([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAiCommitModels(false);
        }
      }
    };

    loadAiCommitModels();

    return () => {
      cancelled = true;
    };
  }, [aiCommitProvider, availableHarnessIds, hasLoadedAiCommitSettings]);

  const handleAddTerminal = async () => {
    if (!canAddPane()) {
      console.warn('All panes are locked. Unlock a pane before adding a new terminal.');
      return;
    }

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

  const handleToggleFastfetch = async (checked: boolean) => {
    try {
      await window.electronAPI.setShowFastfetch(checked);
      setShowFastfetch(checked);
    } catch (err) {
      console.error('Failed to save fastfetch setting:', err);
    }
  };

  const handleToggleAiCommit = async (checked: boolean) => {
    try {
      await window.electronAPI.setAiCommitEnabled(checked);
      setAiCommitEnabled(checked);
    } catch (err) {
      console.error('Failed to save AI commit setting:', err);
    }
  };

  const handleAiCommitProviderChange = async (provider: string) => {
    try {
      await window.electronAPI.setAiCommitProvider(provider);
      setAiCommitProvider(provider);
      setAiCommitModel('');
      await window.electronAPI.setAiCommitModel('');
    } catch (err) {
      console.error('Failed to save AI commit provider:', err);
    }
  };

  const handleAiCommitModelChange = async (model: string) => {
    try {
      await window.electronAPI.setAiCommitModel(model);
      setAiCommitModel(model);
    } catch (err) {
      console.error('Failed to save AI commit model:', err);
    }
  };

  // --- Harness Defaults handlers ---

  const handleToggleHarnessFlag = async (harnessId: string, enabled: boolean) => {
    if (!harnessDefaults) return;
    const newDefaults = {
      ...harnessDefaults,
      [harnessId]: {
        ...harnessDefaults[harnessId],
        flags: harnessFlagsFromToggle(harnessId, enabled),
      },
    };
    setHarnessDefaultsState(newDefaults);
    try {
      await window.electronAPI.setHarnessDefaults(newDefaults);
    } catch (err) {
      console.error('Failed to save harness flags:', err);
    }
  };

  const handleSetDefaultModel = async (harnessId: string, modelId: string) => {
    if (!harnessDefaults) return;
    const newDefaults = {
      ...harnessDefaults,
      [harnessId]: {
        ...harnessDefaults[harnessId],
        model: modelId,
      },
    };
    setHarnessDefaultsState(newDefaults);
    try {
      await window.electronAPI.setHarnessDefaults(newDefaults);
    } catch (err) {
      console.error('Failed to save default model:', err);
    }
  };

  const handleToggleFavorite = async (harnessId: string, modelId: string) => {
    if (!harnessDefaults) return;
    const currentFavorites = harnessDefaults[harnessId]?.favorites ?? [];
    const isFavorite = currentFavorites.includes(modelId);
    const newFavorites = isFavorite
      ? currentFavorites.filter((id) => id !== modelId)
      : [...currentFavorites, modelId];
    const newDefaults = {
      ...harnessDefaults,
      [harnessId]: {
        ...harnessDefaults[harnessId],
        favorites: newFavorites,
      },
    };
    setHarnessDefaultsState(newDefaults);
    try {
      await window.electronAPI.setHarnessDefaults(newDefaults);
    } catch (err) {
      console.error('Failed to save harness favorites:', err);
    }
  };

  /**
   * Load and cache harness models on demand.
   * Cached results are reused across accordion opens.
   */
  const loadHarnessModels = async (harnessId: string) => {
    if (harnessModelCache[harnessId] !== undefined) return;
    setHarnessModelLoading((prev) => ({ ...prev, [harnessId]: true }));
    try {
      const models = await window.electronAPI.getHarnessModels(harnessId);
      setHarnessModelCache((prev) => ({ ...prev, [harnessId]: models }));
    } catch (err) {
      console.error(`Failed to load models for ${harnessId}:`, err);
      setHarnessModelCache((prev) => ({ ...prev, [harnessId]: [] }));
    } finally {
      setHarnessModelLoading((prev) => ({ ...prev, [harnessId]: false }));
    }
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

  const aiCommitProviderOptions = HARNESS_OPTIONS
    .filter((option) => option.id !== '' && AI_COMMIT_PROVIDER_IDS.includes(option.id as typeof AI_COMMIT_PROVIDER_IDS[number]))
    .filter((option) => availableHarnessIds.includes(option.id));

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

        <button className="header-btn header-btn-primary" type="button" onClick={handleAddTerminal} disabled={!canAddPane()}>
          <Plus size={15} strokeWidth={2.5} />
          New Terminal
        </button>

        <button type="button" className={`header-btn ${browserVisible ? 'active' : ''}`} onClick={handleToggleBrowser} title="Toggle browser panel">
          <Globe size={15} strokeWidth={2} />
          Browser
        </button>
        
        {workspacePath && (
          <GitButton workspacePath={workspacePath} />
        )}
      </div>

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
            onClick={() => void handleToggleChatHistory()}
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
              onClose={() => setShowChatHistory(false)}
            />
          )}
        </div>
        <div className="settings-dropdown-container" ref={settingsDropdownRef}>
          <button 
            className="header-btn"
            type="button"
            onClick={() => setShowSettings(!showSettings)}
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
                  onChange={(e) => handleToggleFastfetch(e.target.checked)}
                />
                <span>Show fastfetch</span>
              </label>

              <div className="settings-section">
                <label className="settings-option">
                  <input
                    type="checkbox"
                    checked={aiCommitEnabled}
                    onChange={(e) => handleToggleAiCommit(e.target.checked)}
                  />
                  <span>AI commit messages</span>
                </label>

                <div className="settings-row">
                  <span className="settings-row-label">Provider</span>
                  <select
                    className="settings-select"
                    value={aiCommitProvider}
                    onChange={(e) => void handleAiCommitProviderChange(e.target.value)}
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
                    onChange={(e) => void handleAiCommitModelChange(e.target.value)}
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
              <button
                type="button"
                className="settings-dropdown-action"
                onClick={() => {
                  setShowCredentialModal(true);
                  setShowSettings(false);
                }}
              >
                Manage VCS credentials
              </button>

              {/* Harness Defaults Section */}
              {harnessDefaults && (
                <div className="settings-section">
                  <div className="settings-section-title">Harness Defaults</div>
                  {KNOWN_HARNESS_IDS.filter((id) => availableHarnessIds.includes(id)).map((harnessId) => {
                    const Opt = HARNESS_OPTIONS.find((o) => o.id === harnessId);
                    const defaults = harnessDefaults[harnessId];
                    const isExpanded = expandedHarness === harnessId;
                    const isFlagEnabled = harnessToggleFromFlags(harnessId, defaults?.flags ?? '');
                    const models = harnessModelCache[harnessId] ?? [];
                    const isModelsLoading = harnessModelLoading[harnessId] ?? false;

                    // Determine label for the current default model
                    const currentModelId = defaults?.model ?? '';
                    const modelLabel = currentModelId
                      ? (models.find((m) => m.id === currentModelId)?.label ?? currentModelId)
                      : '';

                    return (
                      <div key={harnessId} className="harness-defaults-row">
                        <button
                          type="button"
                          className={`harness-defaults-header ${isExpanded ? 'expanded' : ''}`}
                          onClick={() => {
                            if (!isExpanded) {
                              setExpandedHarness(harnessId);
                              void loadHarnessModels(harnessId);
                            } else {
                              setExpandedHarness(null);
                            }
                          }}
                        >
                          {Opt && (() => {
                            const HarnessIcon = Opt.Icon;
                            return <HarnessIcon size={13} strokeWidth={2.5} />;
                          })()}
                          <span className="harness-defaults-label">{Opt?.label ?? harnessId}</span>
                          {currentModelId && (
                            <span
                              className={`harness-defaults-current ${!models.some((m) => m.id === currentModelId) ? 'unresolved' : ''}`}
                              title={
                                !models.some((m) => m.id === currentModelId)
                                  ? 'This model is no longer available'
                                  : modelLabel
                              }
                            >
                              {!models.some((m) => m.id === currentModelId) && (
                                <AlertTriangle size={11} strokeWidth={2} className="unresolved-icon" />
                              )}
                              {modelLabel || currentModelId}
                            </span>
                          )}
                          <ChevronRight
                            size={12}
                            strokeWidth={2}
                            className="harness-defaults-chevron"
                          />
                        </button>

                        {isExpanded && (
                          <div className="harness-defaults-panel">
                            {/* Yolo/Auto toggle */}
                            <label className="harness-defaults-option">
                              <input
                                type="checkbox"
                                checked={isFlagEnabled}
                                onChange={(e) => void handleToggleHarnessFlag(harnessId, e.target.checked)}
                              />
                              <span>
                                {harnessId === 'codex'
                                  ? 'Enable yolo mode'
                                  : harnessId === 'opencode'
                                  ? 'Enable pure mode'
                                  : 'Enable mode flag'}
                              </span>
                            </label>

                            {/* Default model selector */}
                            <div className="harness-defaults-field">
                              <span className="harness-defaults-field-label">Default model</span>
                              <select
                                className="settings-select"
                                value={currentModelId}
                                onChange={(e) => void handleSetDefaultModel(harnessId, e.target.value)}
                                disabled={isModelsLoading}
                              >
                                <option value="">Use harness default</option>
                                {isModelsLoading ? (
                                  <option value="">Loading...</option>
                                ) : models.length === 0 ? (
                                  <option value="">No models available</option>
                                ) : (
                                  models.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.label}
                                    </option>
                                  ))
                                )}
                              </select>
                            </div>

                            {/* Favorites list */}
                            {((defaults?.favorites?.length ?? 0) > 0 || models.length > 0) && (
                              <div className="harness-defaults-field">
                                <span className="harness-defaults-field-label">Favorites</span>
                                <div className="harness-defaults-favorites">
                                  {(defaults?.favorites ?? []).map((favId) => {
                                    const favLabel = models.find((m) => m.id === favId)?.label ?? favId;
                                    const isUnresolved = !models.some((m) => m.id === favId);
                                    return (
                                      <span
                                        key={favId}
                                        className={`harness-defaults-favorite-tag ${isUnresolved ? 'unresolved' : ''}`}
                                        title={
                                          isUnresolved
                                            ? 'This model is no longer available — click X to remove'
                                            : favLabel
                                        }
                                      >
                                        {isUnresolved && (
                                          <AlertTriangle size={10} strokeWidth={2} className="unresolved-icon" />
                                        )}
                                        {favLabel}
                                        <button
                                          type="button"
                                          className="harness-defaults-remove-fav"
                                          onClick={() => void handleToggleFavorite(harnessId, favId)}
                                          title="Remove from favorites"
                                        >
                                          ×
                                        </button>
                                      </span>
                                    );
                                  })}
                                  {models
                                    .filter((m) => !(defaults?.favorites ?? []).includes(m.id))
                                    .slice(0, 5)
                                    .map((m) => (
                                      <button
                                        key={m.id}
                                        type="button"
                                        className="harness-defaults-add-fav"
                                        onClick={() => void handleToggleFavorite(harnessId, m.id)}
                                        title={`Add ${m.label} to favorites`}
                                      >
                                        <Star size={10} strokeWidth={2} />
                                        {m.label}
                                      </button>
                                    ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <CredentialSettings
        isOpen={showCredentialModal}
        onClose={() => setShowCredentialModal(false)}
        workspacePath={workspacePath || undefined}
      />
    </header>
  );
}
