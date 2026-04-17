import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FolderOpen, Folder, Loader2, Play, ChevronRight, ChevronDown, Check, Star, Search, X, AlertTriangle } from 'lucide-react';
import { HARNESS_OPTIONS, resolveAvailableHarnessIds } from '../lib/harnessOptions';
import type { ModelOption } from '../types/shared';
import './WorkspaceGate.css';

export interface WorkspaceFormData {
  path: string;
  terminalCount: number;
  harness: string;
  model?: string;
}

interface ContentProps {
  initialPath?: string;
  onSubmit: (data: WorkspaceFormData) => void;
}

const STORAGE_KEY = 'clanker-grid-last-path';

export const TERMINAL_PRESETS = [
  { count: 1, label: '1', description: 'Single terminal' },
  { count: 2, label: '2', description: 'Two terminals' },
  { count: 4, label: '4', description: 'Four terminals' },
];

export default function WorkspaceGateContent({ initialPath, onSubmit }: ContentProps) {
  const [inputValue, setInputValue] = useState(initialPath || '');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(2); // Default to 2 (index 2)
  const [selectedHarness, setSelectedHarness] = useState('codex'); // Default to codex
  const [availableHarnessIds, setAvailableHarnessIds] = useState<string[]>(['']);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [allModels, setAllModels] = useState<Record<string, ModelOption[]>>({});
  const [modelsLoaded, setModelsLoaded] = useState(false);
  // Compact picker state
  const [showFavoritesPicker, setShowFavoritesPicker] = useState(false);
  const [showDiscoveryModal, setShowDiscoveryModal] = useState(false);
  const [discoverySearch, setDiscoverySearch] = useState('');
  const [defaultModel, setDefaultModel] = useState<string>('');

  const inputRef = useRef<HTMLInputElement>(null);

  // Load harnessDefaults from electron-store on mount
  useEffect(() => {
    const loadDefaults = async () => {
      try {
        const defaults = await window.electronAPI.getHarnessDefaults();
        if (defaults[selectedHarness]) {
          setFavorites(defaults[selectedHarness].favorites);
          setDefaultModel(defaults[selectedHarness].model || '');
        }
      } catch {
        // ignore load errors — defaults handle empty state
      }
    };
    void loadDefaults();
  }, []);

  const toggleFavorite = useCallback(
    async (harnessId: string, modelId: string) => {
      const updatedDefaults = await window.electronAPI.getHarnessDefaults();
      const currentFavorites = [...(updatedDefaults[harnessId]?.favorites || [])];
      const index = currentFavorites.indexOf(modelId);
      if (index === -1) {
        currentFavorites.push(modelId);
      } else {
        currentFavorites.splice(index, 1);
      }
      const updated = {
        ...updatedDefaults,
        [harnessId]: {
          ...updatedDefaults[harnessId],
          favorites: currentFavorites,
        },
      };
      await window.electronAPI.setHarnessDefaults(updated);
      setFavorites(currentFavorites);
    },
    []
  );

  // Keep favorites in sync when selected harness changes
  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const defaults = await window.electronAPI.getHarnessDefaults();
        setFavorites(defaults[selectedHarness]?.favorites || []);
        setDefaultModel(defaults[selectedHarness]?.model || '');
      } catch {
        setFavorites([]);
        setDefaultModel('');
      }
    };
    void loadFavorites();
  }, [selectedHarness]);

  // Load last used path
  useEffect(() => {
    if (initialPath) {
      setInputValue(initialPath);
      return;
    }
    
    const loadPath = async () => {
      try {
        const lastPath = localStorage.getItem(STORAGE_KEY);
        if (lastPath) {
          setInputValue(lastPath);
        } else {
          const defaultPath = await window.electronAPI.getLastWorkspace();
          setInputValue(defaultPath || '/home/');
        }
      } catch {
        setInputValue('/home/');
      }
    };
    loadPath();
  }, [initialPath]);

  // Load harnesses and pre-load models for all available harnesses
  useEffect(() => {
    let cancelled = false;

    const loadHarnessOptions = async () => {
      try {
        const options = await window.electronAPI.getHarnessOptions();
        if (cancelled) return;

        const availableIds = resolveAvailableHarnessIds(options);

        setAvailableHarnessIds(availableIds);
        setSelectedHarness((current) => availableIds.includes(current) ? current : (availableIds.find((id) => id !== '') ?? ''));

        // Pre-load models for all available harnesses
        const harnessIds = availableIds.filter((id) => id !== '');
        const modelsMap: Record<string, ModelOption[]> = {};
        await Promise.all(
          harnessIds.map(async (harnessId) => {
            try {
              const models = await window.electronAPI.getHarnessModels(harnessId);
              if (!cancelled) {
                modelsMap[harnessId] = models;
              }
            } catch {
              if (!cancelled) {
                modelsMap[harnessId] = [];
              }
            }
          })
        );
        if (!cancelled) {
          setAllModels(modelsMap);
          setModelsLoaded(true);
          // Set initial model options for the default harness
          const defaultHarness = availableIds.includes('codex') ? 'codex' : availableIds.find((id) => id !== '') || '';
          if (defaultHarness && modelsMap[defaultHarness]) {
            setModelOptions(modelsMap[defaultHarness]);
          }
        }
      } catch {
        if (!cancelled) {
          setAvailableHarnessIds(['']);
          setSelectedHarness('');
        }
      }
    };

    loadHarnessOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  // Update model options when harness changes (using pre-loaded models)
  useEffect(() => {
    if (!selectedHarness) {
      setModelOptions([]);
      setShowFavoritesPicker(false);
      setShowDiscoveryModal(false);
      return;
    }

    const harnessModels = allModels[selectedHarness];
    if (harnessModels) {
      setModelOptions(harnessModels);
    } else if (modelsLoaded) {
      // Models were loaded but this harness has none
      setModelOptions([]);
    }
  }, [selectedHarness, allModels, modelsLoaded]);

  // Close favorites picker on outside click
  useEffect(() => {
    if (!showFavoritesPicker) return;
    const handlePointerDown = (event: MouseEvent) => {
      const picker = document.querySelector('.model-picker');
      if (picker && !picker.contains(event.target as Node)) {
        setShowFavoritesPicker(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [showFavoritesPicker]);

  // Close discovery modal on Escape
  useEffect(() => {
    if (!showDiscoveryModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowDiscoveryModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showDiscoveryModal]);

  // Fetch directory suggestions
  const fetchSuggestions = useCallback(async (path: string) => {
    if (!path || path === '/') {
      setSuggestions([]);
      return;
    }

    const basePath = path.endsWith('/') ? path.slice(0, -1) : path;
    const lastSlash = basePath.lastIndexOf('/');
    
    if (lastSlash <= 0) {
      setSuggestions([]);
      return;
    }

    const dirPath = basePath.substring(0, lastSlash + 1);
    const prefix = basePath.substring(lastSlash + 1).toLowerCase();

    try {
      const entries = await window.electronAPI.readDirectory(dirPath);
      
      const dirs = entries
        .filter(entry => entry.isDirectory)
        .map(entry => dirPath + entry.name + '/')
        .filter(name => {
          const nameWithoutSlash = name.slice(0, -1);
          const lastPart = nameWithoutSlash.substring(nameWithoutSlash.lastIndexOf('/') + 1);
          return lastPart.toLowerCase().includes(prefix);
        })
        .sort((a, b) => {
          const aName = a.slice(0, -1).split('/').pop() || '';
          const bName = b.slice(0, -1).split('/').pop() || '';
          if (aName.length !== bName.length) return aName.length - bName.length;
          return aName.localeCompare(bName);
        })
        .slice(0, 8);

      setSuggestions(dirs);
    } catch {
      setSuggestions([]);
    }
  }, []);

  // Debounced fetch on input change
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSuggestions(inputValue);
    }, 150);
    return () => clearTimeout(timer);
  }, [inputValue, fetchSuggestions]);

  const handleOpenDirectory = async () => {
    setIsLoading(true);

    try {
      const selected = await window.electronAPI.openDirectoryDialog();
      if (selected) {
        const path = selected.endsWith('/') ? selected : selected + '/';
        setInputValue(path);
        setSuggestions([]);
        localStorage.setItem(STORAGE_KEY, path);
      }
    } catch (err) {
      console.error('Failed to open directory:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleHarnessChange = (harness: string) => {
    setSelectedHarness(harness);
    setModelOptions([]);
    setShowFavoritesPicker(false);
    setShowDiscoveryModal(false);
  };

  const handleSubmit = () => {
    const path = inputValue.trim();
    if (!path) return;

    const finalPath = path.endsWith('/') ? path : path + '/';
    
    if (!finalPath.startsWith('/')) {
      return;
    }

    localStorage.setItem(STORAGE_KEY, finalPath);
    const preset = TERMINAL_PRESETS[selectedPreset];
    // Use defaultModel (from store) as the launch model, falling back to first available
    const launchModel = defaultModel || modelOptions[0]?.id || undefined;
    onSubmit({
      path: finalPath,
      terminalCount: preset.count,
      harness: selectedHarness,
      model: selectedHarness ? launchModel : undefined,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        setInputValue(suggestions[selectedIndex]);
        setSuggestions([]);
        setSelectedIndex(-1);
        localStorage.setItem(STORAGE_KEY, suggestions[selectedIndex]);
      } else {
        handleSubmit();
      }
    } else if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault();
      const index = selectedIndex >= 0 ? selectedIndex : 0;
      setInputValue(suggestions[index]);
      setSelectedIndex(index);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setSelectedIndex(prev => prev < suggestions.length - 1 ? prev + 1 : 0);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setSelectedIndex(prev => prev > 0 ? prev - 1 : suggestions.length - 1);
      }
    } else if (e.key === 'Escape') {
      setSuggestions([]);
      setSelectedIndex(-1);
      inputRef.current?.blur();
    } else if (e.key === '1' && !isFocused) {
      e.preventDefault();
      setSelectedPreset(0);
    } else if (e.key === '2' && !isFocused) {
      e.preventDefault();
      setSelectedPreset(1);
    } else if (e.key === '4' && !isFocused) {
      e.preventDefault();
      setSelectedPreset(2);
    } else if ((e.key === 'b' || e.key === 'B') && !isFocused && selectedHarness !== '') {
      e.preventDefault();
      handleHarnessChange('');
    } else if ((e.key === 'c' || e.key === 'C') && !isFocused && availableHarnessIds.includes('codex')) {
      e.preventDefault();
      handleHarnessChange('codex');
    } else if ((e.key === 'o' || e.key === 'O') && !isFocused && availableHarnessIds.includes('opencode')) {
      e.preventDefault();
      handleHarnessChange('opencode');
    } else if ((e.key === 'p' || e.key === 'P') && !isFocused && !e.metaKey && !e.ctrlKey && availableHarnessIds.includes('pi')) {
      e.preventDefault();
      handleHarnessChange('pi');
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
    setSuggestions([]);
    setSelectedIndex(-1);
    localStorage.setItem(STORAGE_KEY, suggestion);
    inputRef.current?.focus();
  };

  const showSuggestions = isFocused && suggestions.length > 0;
  const showModelSelector = selectedHarness !== '';

  // Determine if the current default model is unresolved
  const isModelUnresolved = useCallback((modelId: string): boolean => {
    if (!modelId) return false;
    return !modelOptions.some((m) => m.id === modelId);
  }, [modelOptions]);

  // Sort models: favorites first, then alphabetically
  const sortedModelOptions = useMemo(() => {
    if (!modelOptions.length) return [];
    return [...modelOptions].sort((a, b) => {
      const aFav = favorites.includes(a.id);
      const bFav = favorites.includes(b.id);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return a.label.localeCompare(b.label);
    });
  }, [modelOptions, favorites]);

  // Filtered discovery models
  const discoveryModels = useMemo(() => {
    const query = discoverySearch.toLowerCase();
    return sortedModelOptions.filter((m) =>
      m.label.toLowerCase().includes(query) || m.id.toLowerCase().includes(query)
    );
  }, [sortedModelOptions, discoverySearch]);

  return (
    <div className="gate-content">
      <img src="./robot-icon.png" alt="Clanker Grid" width="96" height="96" />
      
      <h1 className="gate-title">Clanker Grid</h1>
      <p className="gate-subtitle">Developer Workspace Launcher</p>
      
      <div className="gate-input-container">
        <div className="input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="gate-input"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setSelectedIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            placeholder="/home/username/projects/"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
          />
          <button 
            className="cog-button"
            onClick={handleOpenDirectory}
            disabled={isLoading}
            title="Browse directories"
          >
            {isLoading ? (
              <Loader2 size={18} className="spin" />
            ) : (
              <FolderOpen size={18} strokeWidth={2} />
            )}
          </button>
        </div>
        
        {showSuggestions && (
          <ul className="suggestions-list">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion}
                className={`suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleSuggestionClick(suggestion)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <Folder size={14} strokeWidth={2} className="suggestion-icon" />
                <span className="suggestion-path">{suggestion}</span>
                <ChevronRight size={12} className="suggestion-arrow" />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="harness-selector">
        <span className="harness-selector-label">Harness</span>
        <div className="harness-options">
          {HARNESS_OPTIONS.filter((harness) => availableHarnessIds.includes(harness.id)).map((harness) => (
            <button
              key={harness.id}
              className={`harness-option ${selectedHarness === harness.id ? 'selected' : ''}`}
              onClick={() => handleHarnessChange(harness.id)}
              title={harness.id ? `Select ${harness.label}` : 'No harness (basic terminal)'}
            >
              <harness.Icon size={20} strokeWidth={2} className="harness-icon" />
              <span className="harness-label">{harness.label}</span>
            </button>
          ))}
        </div>
      </div>

      {showModelSelector && (
        <div className="model-picker">
          {/* Compact model pill */}
          <button
            type="button"
            className="model-pill"
            onClick={() => {
              setShowFavoritesPicker(true);
              setShowDiscoveryModal(false);
            }}
            title="Change model"
          >
            <span className={`model-pill-label ${isModelUnresolved(defaultModel) ? 'unresolved' : ''}`}>
              {defaultModel
                ? (modelOptions.find((m) => m.id === defaultModel)?.label ?? defaultModel)
                : 'Default model'}
            </span>
            {isModelUnresolved(defaultModel) && (
              <AlertTriangle size={12} className="model-pill-warning" />
            )}
            <ChevronDown size={12} strokeWidth={2.5} className="model-pill-caret" />
          </button>

          {/* Favorites picker popover */}
          {showFavoritesPicker && (
            <div
              className="favorites-picker"
              role="listbox"
              aria-label="Favorite models"
            >
              {favorites.length === 0 ? (
                <div className="favorites-empty">
                  <span className="favorites-empty-text">
                    {defaultModel ? modelOptions.find((m) => m.id === defaultModel)?.label ?? 'Default model' : 'No default set'}
                  </span>
                </div>
              ) : (
                favorites.map((favId) => {
                  const model = modelOptions.find((m) => m.id === favId);
                  const isUnresolved = isModelUnresolved(favId);
                  return (
                    <div
                      key={favId}
                      className={`favorites-item ${defaultModel === favId ? 'selected' : ''} ${isUnresolved ? 'unresolved' : ''}`}
                      onClick={() => {
                        setDefaultModel(favId);
                        setShowFavoritesPicker(false);
                      }}
                    >
                      <button
                        type="button"
                        className="favorites-star-btn favorited"
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleFavorite(selectedHarness, favId);
                        }}
                        title="Remove from favorites"
                        aria-label="Remove from favorites"
                      >
                        <Star size={12} fill="currentColor" />
                      </button>
                      <span className="favorites-model-label">
                        {model?.label ?? favId}
                        {isUnresolved && (
                          <AlertTriangle size={10} className="favorites-unresolved-icon" />
                        )}
                      </span>
                      {defaultModel === favId && (
                        <Check size={12} strokeWidth={2.5} className="favorites-check" />
                      )}
                    </div>
                  );
                })
              )}
              <button
                type="button"
                className="favorites-browse-link"
                onClick={() => {
                  setShowFavoritesPicker(false);
                  setShowDiscoveryModal(true);
                  setDiscoverySearch('');
                }}
              >
                Browse all models
              </button>
            </div>
          )}

          {/* Discovery modal */}
          {showDiscoveryModal && (
            <div className="discovery-modal">
              <div className="discovery-header">
                <span className="discovery-title">All Models</span>
                <button
                  type="button"
                  className="discovery-close"
                  onClick={() => setShowDiscoveryModal(false)}
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="discovery-search-wrap">
                <Search size={14} className="discovery-search-icon" />
                <input
                  type="text"
                  className="discovery-search-input"
                  placeholder="Search models..."
                  value={discoverySearch}
                  onChange={(e) => setDiscoverySearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="discovery-list">
                {discoveryModels.length === 0 ? (
                  <div className="discovery-empty">No models found</div>
                ) : (
                  discoveryModels.map((model) => {
                    const isFav = favorites.includes(model.id);
                    const isSelected = defaultModel === model.id;
                    return (
                      <div
                        key={model.id}
                        className={`discovery-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setDefaultModel(model.id);
                          setShowDiscoveryModal(false);
                        }}
                      >
                        <button
                          type="button"
                          className={`discovery-star-btn ${isFav ? 'favorited' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleFavorite(selectedHarness, model.id);
                          }}
                          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                          aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <Star size={12} fill={isFav ? 'currentColor' : 'none'} />
                        </button>
                        <span className="discovery-model-label">{model.label}</span>
                        {isSelected && (
                          <Check size={12} strokeWidth={2.5} className="discovery-check" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid-selector">
        <span className="grid-selector-label">Terminals</span>
        <div className="grid-options">
          {TERMINAL_PRESETS.map((preset, index) => (
            <button
              key={preset.count}
              className={`grid-option ${selectedPreset === index ? 'selected' : ''}`}
              onClick={() => setSelectedPreset(index)}
              title={`Press ${preset.label} to select`}
            >
              <span className="preset-count">{preset.count}</span>
              <span className="grid-label">{preset.label} terminal{preset.count > 1 ? 's' : ''}</span>
            </button>
          ))}
        </div>
      </div>

      <button 
        className="gate-button"
        onClick={handleSubmit}
      >
        <Play size={16} strokeWidth={2.5} fill="currentColor" />
        Launch Workspace
      </button>

      <div className="gate-shortcuts">
        <span className="shortcut">
          <kbd>Tab</kbd> autocomplete
        </span>
        <span className="shortcut">
          Use buttons or shortcuts to choose a harness
        </span>
        <span className="shortcut">
          <kbd>↵</kbd> launch
        </span>
      </div>
    </div>
  );
}
