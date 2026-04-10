import { useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Plus, Globe, LayoutGrid, Settings, ChevronDown, PanelLeft, PanelLeftClose } from 'lucide-react';
import { AI_COMMIT_PROVIDER_IDS, HARNESS_OPTIONS, resolveAvailableHarnessIds } from '../lib/harnessOptions';
import type { ModelOption } from '../types/shared';
import GitButton from './GitButton';
import CredentialSettings from './settings/CredentialSettings';
import './Header.css';

export default function Header() {
  const { 
    workspacePath, 
    browserVisible,
    explorerVisible,
    setExplorerVisible,
    toggleBrowser,
    addTerminal,
    fitAllPanes,
    harness,
    model,
    setHarness,
    canAddPane,
    pushBrowserOverlay,
    popBrowserOverlay,
  } = useWorkspaceStore();
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
  const settingsDropdownRef = useRef<HTMLDivElement>(null);

  // Hide the native browser whenever the settings dropdown is open.
  useEffect(() => {
    if (!showSettings) {
      return;
    }

    pushBrowserOverlay();
    return () => popBrowserOverlay();
  }, [showSettings, pushBrowserOverlay, popBrowserOverlay]);

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
      const activeHarness = availableHarnessIds.includes(harness) ? harness : '';
      const activeModel = activeHarness ? (model || undefined) : undefined;
      const info = await window.electronAPI.spawnTerminal(workspacePath || '/', activeHarness || undefined, activeModel);
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
          {HARNESS_OPTIONS.filter((opt) => availableHarnessIds.includes(opt.id)).map(opt => (
            <button
              key={opt.id}
              className={`harness-pill ${harness === opt.id ? 'active' : ''}`}
              onClick={() => setHarness(opt.id)}
              title={opt.label}
            >
              <opt.Icon size={14} strokeWidth={2.5} />
              <span>{opt.label}</span>
              </button>
            ))}
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
            </div>
          )}
        </div>
      </div>
      <CredentialSettings
        isOpen={showCredentialModal}
        onClose={() => setShowCredentialModal(false)}
        workspacePath={workspacePath ?? undefined}
      />
    </header>
  );
}
