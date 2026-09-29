import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FolderOpen, Folder, Loader2, Play, ChevronRight, ChevronDown, Check, Star, Search, X, AlertTriangle, Cog, GitBranch, ArrowLeft, Settings } from 'lucide-react';
import type { WorkspaceRecipe, RecipeLaunchResult } from '../../shared/types/recipes';
import type { SshEnvironmentConfig } from '../../shared/types/environments';
import RecipeModal from './RecipeModal';
import { HARNESS_OPTIONS, resolveAvailableHarnessIds, resolveVisibleHarnessIds } from '../lib/harnessOptions';
import { hermesModelDisplay, hermesModelLabel } from '../lib/hermesModelDisplay';
import type { ModelOption } from '../types/shared';
import type { HarnessDefaultsMap } from '../../shared/types/store';
import { isAbsoluteWorkspacePath } from '../../shared/pathClassify';
import { useWorkspaceStore } from '../store/workspaceStore';
import WorktreeLauncher from './WorktreeLauncher';
import GateHarnessSettings from './GateHarnessSettings';
import { findGeneratedWorktreeContainerOwner } from '../lib/worktreeContainer';
import { getWorkspaceNameFromPath } from '../lib/workspaceLabels';
import { joinPaths } from '../lib/pathUtils';
import RemoteWorkspacePath from './RemoteWorkspacePath';
import './WorkspaceGate.css';

export interface WorkspaceFormData {
  path: string;
  terminalCount: number;
  harness: string;
  model?: string;
  environmentId?: string;
  environmentLabel?: string;
}

interface ContentProps {
  initialPath?: string;
  onSubmit: (data: WorkspaceFormData) => void;
  onLaunchRecipe?: (recipe: WorkspaceRecipe) => Promise<RecipeLaunchResult | null | void>;
}

function withTrailingSlash(path: string): string {
  // Normalize backslashes to forward slashes for cross-platform consistency.
  // On Windows, paths from the main process use backslashes; the renderer
  // works with forward slashes internally.
  const normalized = path.replace(/\\/g, '/');
  return normalized.endsWith('/') ? normalized : normalized + '/';
}

function resolveWorkspacePath(input: string, baseDirectory: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, '/');
  const resolved = isAbsoluteWorkspacePath(normalized) ? normalized : baseDirectory ? baseDirectory + normalized : '';
  return resolved ? withTrailingSlash(resolved) : null;
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT';
}

export const TERMINAL_PRESETS = [
  { count: 1, label: '1', description: 'Single terminal' },
  { count: 2, label: '2', description: 'Two terminals' },
  { count: 4, label: '4', description: 'Four terminals' },
];

function HermesModelName({ option }: { option: ModelOption }) {
  const { model, provider } = hermesModelDisplay(option);
  return (
    <span className="hermes-model-name" title={hermesModelLabel(option)}>
      <span className="hermes-model-id">{model}</span>
      {provider && <span className="hermes-model-provider">{provider}</span>}
    </span>
  );
}

export default function WorkspaceGateContent({ initialPath, onSubmit, onLaunchRecipe }: ContentProps) {
  const [savedRecipes, setSavedRecipes] = useState<WorkspaceRecipe[]>([]);
  const [selectedRecipeForModal, setSelectedRecipeForModal] = useState<WorkspaceRecipe | null>(null);
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [inputValue, setInputValue] = useState(initialPath || '');
  const [baseDirectory, setBaseDirectory] = useState<string>('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [isBaseLoading, setIsBaseLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(2); // Default to 2 (index 2)
  const [selectedHarness, setSelectedHarness] = useState('codex'); // Default to codex
  const [availableHarnessIds, setAvailableHarnessIds] = useState<string[]>(['']);
  const [hasLoadedHarnessOptions, setHasLoadedHarnessOptions] = useState(false);
  const [harnessDefaults, setHarnessDefaults] = useState<HarnessDefaultsMap | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [allModels, setAllModels] = useState<Record<string, ModelOption[]>>({});
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [isRefreshingHermesModels, setIsRefreshingHermesModels] = useState(false);
  const refreshedHermesModelsRef = useRef<ModelOption[] | null>(null);
  // Compact picker state
  const [showFavoritesPicker, setShowFavoritesPicker] = useState(false);
  const [showDiscoveryModal, setShowDiscoveryModal] = useState(false);
  const [discoverySearch, setDiscoverySearch] = useState('');
  const [modelOverrides, setModelOverrides] = useState<Record<string, string>>({});
  const [locationKind, setLocationKind] = useState<'local' | 'ssh'>('local');
  const defaultModel = locationKind === 'ssh' ? '' : modelOverrides[selectedHarness] ?? harnessDefaults?.[selectedHarness]?.model ?? '';
  const selectedModelOption = modelOptions.find((model) => model.id === defaultModel);
  const setDefaultModel = (modelId: string) => {
    setModelOverrides((overrides) => ({ ...overrides, [selectedHarness]: modelId }));
  };
  const [workspaceMode, setWorkspaceMode] = useState<'directory' | 'worktree' | 'settings'>('directory');
  const [hasViewedWorktree, setHasViewedWorktree] = useState(false);
  const [repoCheck, setRepoCheck] = useState<{ path: string; isRepo: boolean } | null>(null);
  const [directoryError, setDirectoryError] = useState('');
  const openWorkspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const openPaths = openWorkspaces
    .filter((workspace) => !workspace.environmentId || workspace.environmentId === 'local')
    .map((workspace) => workspace.workspacePath);
  const selectedPath = resolveWorkspacePath(inputValue, baseDirectory);
  const activeWorkspace = openWorkspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const activeWorkspacePath = activeWorkspace && (!activeWorkspace.environmentId || activeWorkspace.environmentId === 'local')
    ? activeWorkspace.workspacePath
    : null;
  const repoCandidatePath = selectedPath ?? (!inputValue.trim() ? activeWorkspacePath : null);
  const worktreeReady = !!repoCandidatePath && repoCheck?.path === repoCandidatePath && repoCheck.isRepo;
  const [sshEnvironments, setSshEnvironments] = useState<SshEnvironmentConfig[]>([]);
  const [selectedSshEnvId, setSelectedSshEnvId] = useState<string>('');
  const [remotePath, setRemotePath] = useState('');
  const updateRemotePath = useCallback((path: string) => {
    setRemotePath(path);
    setDirectoryError('');
  }, []);
  const [showSshManager, setShowSshManager] = useState(false);
  const [sshFormLabel, setSshFormLabel] = useState('');
  const [sshFormTarget, setSshFormTarget] = useState('');
  const [sshTestStatus, setSshTestStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isTestingSsh, setIsTestingSsh] = useState(false);
  const [sshSaveError, setSshSaveError] = useState('');

  const refreshSshEnvironments = useCallback(async () => {
    if (typeof window.electronAPI?.sshEnvironmentList === 'function') {
      try {
        const list = await window.electronAPI.sshEnvironmentList();
        setSshEnvironments(list);
        setSelectedSshEnvId((prev) => list.some((env) => env.id === prev) ? prev : (list[0]?.id ?? ''));
      } catch {
        // Ignore
      }
    }
  }, []);

  useEffect(() => {
    void refreshSshEnvironments();
  }, [refreshSshEnvironments]);

  const handleTestSsh = async () => {
    if (!sshFormTarget.trim()) {
      setSshTestStatus({ success: false, message: 'Please enter an SSH target' });
      return;
    }
    setIsTestingSsh(true);
    setSshTestStatus(null);
    try {
      const res = await window.electronAPI.sshEnvironmentTest(sshFormTarget.trim());
      if (res.success) {
        setSshTestStatus({ success: true, message: 'Connection successful!' });
      } else {
        setSshTestStatus({ success: false, message: res.error || 'Connection failed' });
      }
    } catch (err) {
      setSshTestStatus({ success: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsTestingSsh(false);
    }
  };

  const handleSaveSshEnv = async () => {
    if (!sshFormLabel.trim() || !sshFormTarget.trim()) {
      setSshSaveError('Label and target are required');
      return;
    }
    setSshSaveError('');
    try {
      const res = await window.electronAPI.sshEnvironmentSave({
        id: crypto.randomUUID(),
        kind: 'ssh',
        label: sshFormLabel.trim(),
        target: sshFormTarget.trim(),
      });
      if (res.success && res.config) {
        setSshFormLabel('');
        setSshFormTarget('');
        setSshTestStatus(null);
        setRemotePath('');
        setSelectedSshEnvId(res.config.id);
        await refreshSshEnvironments();
      } else {
        setSshSaveError(res.error || 'Failed to save environment');
      }
    } catch (err) {
      setSshSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteSshEnv = async (id: string) => {
    try {
      await window.electronAPI.sshEnvironmentDelete(id);
      if (selectedSshEnvId === id) {
        setRemotePath('');
        setSelectedSshEnvId('');
      }
      await refreshSshEnvironments();
    } catch {
      // Ignore
    }
  };


  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionRequestRef = useRef(0);
  const launchRequestRef = useRef(0);
  const visibleHarnessIds = useMemo(
    () => resolveVisibleHarnessIds(availableHarnessIds, harnessDefaults),
    [availableHarnessIds, harnessDefaults],
  );

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
      setHarnessDefaults(updated);
      setFavorites(currentFavorites);
    },
    []
  );
  useEffect(() => {
    let cancelled = false;
    if (typeof window.electronAPI?.recipeGetAll === 'function') {
      window.electronAPI.recipeGetAll()
        .then((res) => {
          if (!cancelled && Array.isArray(res)) {
            setSavedRecipes(res);
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Load persisted defaults once; changing harnesses only changes which
  // defaults are displayed, without racing another settings request.
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.getHarnessDefaults()
      .then((defaults) => {
        if (cancelled) return;
        setHarnessDefaults(defaults);
      })
      .catch(() => {
        if (!cancelled) setFavorites([]);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setFavorites(harnessDefaults?.[selectedHarness]?.favorites ?? []);
  }, [harnessDefaults, selectedHarness]);

  useEffect(() => {
    if (!hasLoadedHarnessOptions) {
      return;
    }

    setSelectedHarness((current) =>
      visibleHarnessIds.includes(current)
        ? current
        : (visibleHarnessIds.find((id) => id !== '') ?? '')
    );
  }, [hasLoadedHarnessOptions, visibleHarnessIds]);

  // Load base directory. The input itself stays empty unless an explicit
  // initialPath is passed in — base is the visible context, the input holds
  // a project name relative to it.
  useEffect(() => {
    if (initialPath) {
      setInputValue(initialPath);
    }
    let cancelled = false;
    const loadBase = async () => {
      try {
        const stored = await window.electronAPI.getBaseDirectory();
        if (cancelled) return;
        if (stored) setBaseDirectory(withTrailingSlash(stored));
      } catch {
        // base remains empty; submit guards on it
      }
    };
    void loadBase();
    return () => {
      cancelled = true;
    };
  }, [initialPath]);

  useEffect(() => {
    let cancelled = false;
    if (!repoCandidatePath || typeof window.electronAPI.gitGetBranchState !== 'function') return;
    const timer = setTimeout(() => {
      void window.electronAPI.gitGetBranchState(repoCandidatePath)
        .then(async (result) => {
          const isRepo = result.success && result.isRepo && !await findGeneratedWorktreeContainerOwner(repoCandidatePath);
          if (!cancelled) setRepoCheck({ path: repoCandidatePath, isRepo });
        })
        .catch(() => {
          if (!cancelled) setRepoCheck({ path: repoCandidatePath, isRepo: false });
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [repoCandidatePath]);

  useEffect(() => {
    launchRequestRef.current += 1;
    setDirectoryError('');
  }, [inputValue, baseDirectory]);

  // Load harnesses and pre-load models for all available harnesses
  useEffect(() => {
    let cancelled = false;
    setModelsLoaded(false);
    if (locationKind === 'ssh') setAvailableHarnessIds(['']);
    setModelOptions([]);
    setAllModels({});


    const loadHarnessOptions = async () => {
      if (locationKind === 'ssh') {
        try {
          const options = selectedSshEnvId
            ? await window.electronAPI.getEnvironmentHarnessOptions(selectedSshEnvId)
            : {};
          if (cancelled) return;
          const availableIds = resolveAvailableHarnessIds(options);
          setAvailableHarnessIds(availableIds);
          setSelectedHarness((current) => availableIds.includes(current) ? current : (availableIds.find((id) => id !== '') ?? ''));
        } catch {
          if (!cancelled) setAvailableHarnessIds(['']);
        } finally {
          if (!cancelled) {
            setHasLoadedHarnessOptions(true);
            setModelsLoaded(true);
          }
        }
        return;
      }
      try {
        const options = await window.electronAPI.getHarnessOptions();
        if (cancelled) return;

        const availableIds = resolveAvailableHarnessIds(options);

        setAvailableHarnessIds(availableIds);
        setHasLoadedHarnessOptions(true);
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
          setAllModels(refreshedHermesModelsRef.current
            ? { ...modelsMap, hermes: refreshedHermesModelsRef.current }
            : modelsMap);
          setModelsLoaded(true);
          // Set initial model options for the default harness
          const defaultHarness = availableIds.includes('codex') ? 'codex' : availableIds.find((id) => id !== '') || '';
          if (defaultHarness && modelsMap[defaultHarness]) {
            setModelOptions(defaultHarness === 'hermes'
              ? refreshedHermesModelsRef.current ?? modelsMap[defaultHarness]
              : modelsMap[defaultHarness]);
          }
        }
      } catch {
        if (!cancelled) {
          setAvailableHarnessIds(['']);
          setHasLoadedHarnessOptions(true);
          setSelectedHarness('');
        }
      }
    };

    loadHarnessOptions();

    return () => {
      cancelled = true;
    };
  }, [locationKind, selectedSshEnvId]);

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
  const refreshHermesModels = async () => {
    setIsRefreshingHermesModels(true);
    try {
      const models = await window.electronAPI.getHarnessModels('hermes', true);
      refreshedHermesModelsRef.current = models;
      setAllModels((current) => ({ ...current, hermes: models }));
    } catch (error) {
      console.error('Failed to refresh Hermes models:', error);
    } finally {
      setIsRefreshingHermesModels(false);
    }
  };

  const returnFromSettings = (defaults: HarnessDefaultsMap | null) => {
    if (defaults) {
      setHarnessDefaults(defaults);
    }
    setWorkspaceMode('directory');
  };

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

  useEffect(() => {
    if (!showFavoritesPicker) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowFavoritesPicker(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showFavoritesPicker]);

  // Close discovery modal on Escape
  useEffect(() => {
    if (!showDiscoveryModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowDiscoveryModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showDiscoveryModal]);

  // Fetch directory suggestions. Returns suggestions in the same form as the
  // input value: relative when the input is relative (typed under base),
  // absolute when the input starts with `/`.
  const fetchSuggestions = useCallback(async (input: string, base: string) => {
    const requestId = ++suggestionRequestRef.current;
    const normalizedInput = input.replace(/\\/g, '/');
    const isAbsolute = isAbsoluteWorkspacePath(normalizedInput);
    const hasTrailingSlash = normalizedInput.endsWith('/');

    let dirPath: string;
    let nameFilter: string;
    let suggestionPrefix: string;

    if (isAbsolute) {
      if (normalizedInput === '/' || normalizedInput === '//') {
        setSuggestions([]);
        return;
      }
      if (hasTrailingSlash) {
        dirPath = normalizedInput;
        nameFilter = '';
        suggestionPrefix = normalizedInput;
      } else {
        const trimmed = normalizedInput;
        const lastSlash = trimmed.lastIndexOf('/');
        if (lastSlash < 0) {
          setSuggestions([]);
          return;
        }
        dirPath = trimmed.substring(0, lastSlash + 1);
        nameFilter = trimmed.substring(lastSlash + 1).toLowerCase();
        suggestionPrefix = dirPath;
      }
    } else {
      if (!base) {
        setSuggestions([]);
        return;
      }
      if (hasTrailingSlash) {
        dirPath = base + normalizedInput;
        nameFilter = '';
        suggestionPrefix = normalizedInput;
      } else {
        const trimmed = normalizedInput;
        const lastSlash = trimmed.lastIndexOf('/');
        const relDir = lastSlash < 0 ? '' : trimmed.substring(0, lastSlash + 1);
        nameFilter = (lastSlash < 0 ? trimmed : trimmed.substring(lastSlash + 1)).toLowerCase();
        dirPath = base + relDir;
        suggestionPrefix = relDir;
      }
    }

    if (nameFilter === '') {
      if (requestId === suggestionRequestRef.current) setSuggestions([]);
      return;
    }

    try {
      const entries = await window.electronAPI.readDirectory(dirPath);

      const matchingDirectories = entries
        .filter((entry) => entry.isDirectory)
        .filter((entry) => entry.name.toLowerCase().includes(nameFilter))
        .sort((a, b) => {
          if (a.name.length !== b.name.length) return a.name.length - b.name.length;
          return a.name.localeCompare(b.name);
        });

      const dirs: string[] = [];
      for (let offset = 0; offset < matchingDirectories.length && dirs.length < 8; offset += 16) {
        const batch = matchingDirectories.slice(offset, offset + 16);
        const visible = await Promise.all(batch.map(async (entry) => ({
          entry,
          owner: entry.name.endsWith('-worktrees')
            ? await findGeneratedWorktreeContainerOwner(joinPaths(dirPath, entry.name))
            : null,
        })));
        if (requestId !== suggestionRequestRef.current) return;
        dirs.push(...visible.filter(({ owner }) => !owner).map(({ entry }) => suggestionPrefix + entry.name + '/'));
      }

      setSuggestions(dirs.slice(0, 8));
    } catch {
      if (requestId === suggestionRequestRef.current) setSuggestions([]);
    }
  }, []);

  // Debounced fetch on input or base change
  useEffect(() => {
    suggestionRequestRef.current += 1;
    const timer = setTimeout(() => {
      fetchSuggestions(inputValue, baseDirectory);
    }, 150);
    return () => clearTimeout(timer);
  }, [inputValue, baseDirectory, fetchSuggestions]);

  const handleOpenDirectory = async () => {
    setIsLoading(true);

    try {
      const selected = await window.electronAPI.openDirectoryDialog();
      if (selected) {
        setInputValue(withTrailingSlash(selected));
        setSuggestions([]);
      }
    } catch (err) {
      console.error('Failed to open directory:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenBaseDirectory = async () => {
    setIsBaseLoading(true);
    try {
      const selected = await window.electronAPI.openBaseDirectoryDialog();
      if (selected) {
        setBaseDirectory(withTrailingSlash(selected));
        setSuggestions([]);
      }
    } catch (err) {
      console.error('Failed to open base directory:', err);
    } finally {
      setIsBaseLoading(false);
    }
  };

  const handleHarnessChange = useCallback((harness: string) => {
    setSelectedHarness(harness);
    setModelOptions(allModels[harness] ?? []);
    setShowFavoritesPicker(false);
    setShowDiscoveryModal(false);
  }, [allModels]);

  useEffect(() => {
    const handleLauncherShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
        || isEditableEventTarget(event.target)) return;

      const key = event.key.toLowerCase();
      let handler: (() => void) | undefined;
      if (key === '1') handler = () => setSelectedPreset(0);
      else if (key === '2') handler = () => setSelectedPreset(1);
      else if (key === '4') handler = () => setSelectedPreset(2);
      else if (key === 'b' && selectedHarness !== '') handler = () => handleHarnessChange('');
      else if (key === 'c' && visibleHarnessIds.includes('codex')) handler = () => handleHarnessChange('codex');
      else if (key === 'o' && visibleHarnessIds.includes('opencode')) handler = () => handleHarnessChange('opencode');
      else if (key === 'p' && visibleHarnessIds.includes('pi')) handler = () => handleHarnessChange('pi');
      else if (key === 'a' && visibleHarnessIds.includes('agy')) handler = () => handleHarnessChange('agy');

      if (handler) {
        event.preventDefault();
        handler();
      }
    };

    window.addEventListener('keydown', handleLauncherShortcut);
    return () => window.removeEventListener('keydown', handleLauncherShortcut);
  }, [handleHarnessChange, selectedHarness, visibleHarnessIds]);

  const launchPath = (path: string, envId = 'local', envLabel = 'Local') => {
    const preset = TERMINAL_PRESETS[selectedPreset];
    // Hermes keeps its own default when no explicit model is chosen.
    const launchModel = envId === 'local'
      ? defaultModel || (selectedHarness === 'hermes' ? undefined : modelOptions[0]?.id)
      : undefined;
    onSubmit({
      path,
      terminalCount: preset.count,
      harness: selectedHarness,
      model: selectedHarness ? launchModel : undefined,
      environmentId: envId,
      environmentLabel: envLabel,
    });
  };

  const handleSubmit = () => {
    if (locationKind === 'ssh') {
      if (!selectedSshEnvId) {
        setDirectoryError('Please select or add an SSH environment first');
        return;
      }
      const trimmed = remotePath.trim();
      if (!trimmed) {
        setDirectoryError('Please enter a remote workspace path');
        return;
      }
      if (!trimmed.startsWith('/')) {
        setDirectoryError('Remote path must be an absolute POSIX path starting with /');
        return;
      }
      const env = sshEnvironments.find((e) => e.id === selectedSshEnvId);
      launchPath(trimmed, env?.id || selectedSshEnvId, env?.label || 'Remote');
      return;
    }

    if (!selectedPath) return;
    const requestId = ++launchRequestRef.current;
    if (!getWorkspaceNameFromPath(selectedPath).endsWith('-worktrees')) {
      launchPath(selectedPath, 'local', 'Local');
      return;
    }
    void findGeneratedWorktreeContainerOwner(selectedPath).then((owner) => {
      if (requestId !== launchRequestRef.current) return;
      if (owner) {
        setDirectoryError(`This folder holds worktrees for ${getWorkspaceNameFromPath(owner)}. Choose a checkout inside it or select the repository and use Worktree.`);
      } else {
        launchPath(selectedPath, 'local', 'Local');
      }
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    const setSuggestionAndReset = (suggestion: string) => {
      setInputValue(suggestion);
      setSuggestions([]);
      setSelectedIndex(-1);
    };

    const keyHandlers: Partial<Record<string, () => void>> = {
      Enter: () => {
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          setSuggestionAndReset(suggestions[selectedIndex]);
          return;
        }
        if (workspaceMode === 'directory') handleSubmit();
      },
      Escape: () => {
        setSuggestions([]);
        setSelectedIndex(-1);
        inputRef.current?.blur();
      },
      ArrowDown: () => {
        if (suggestions.length === 0) return;
        setSelectedIndex(prev => prev < suggestions.length - 1 ? prev + 1 : 0);
      },
      ArrowUp: () => {
        if (suggestions.length === 0) return;
        setSelectedIndex(prev => prev > 0 ? prev - 1 : suggestions.length - 1);
      },
      Tab: () => {
        if (suggestions.length === 0) return;
        const index = selectedIndex >= 0 ? selectedIndex : 0;
        setInputValue(suggestions[index]);
        setSelectedIndex(index);
      },
    };


    const handler = keyHandlers[e.key];
    if (handler) {
      e.preventDefault();
      handler();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
    setSuggestions([]);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const showSuggestions = isFocused && suggestions.length > 0;
  const showModelSelector = selectedHarness !== '';

  // Determine if the current default model is unresolved
  const isModelUnresolved = useCallback((modelId: string): boolean => {
    if (!modelId || selectedHarness === 'hermes') return false;
    return !modelOptions.some((m) => m.id === modelId);
  }, [modelOptions, selectedHarness]);

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
      {workspaceMode === 'directory' ? (
      <div className={`gate-view ${hasViewedWorktree ? 'gate-view-return' : ''}`}>
      <div className="gate-header">
        <img src="./robot-icon.png" alt="Clanker Grid" width="64" height="64" className="gate-brand-icon" />
        <h1 className="gate-title">Clanker Grid</h1>
        <p className="gate-subtitle">Developer Workspace Launcher</p>
      </div>

      <div className="gate-location-selector">
        <button
          type="button"
          className={`gate-location-btn ${locationKind === 'local' ? 'active' : ''}`}
          onClick={() => { setLocationKind('local'); setDirectoryError(''); }}
        >
          Local
        </button>
        <button
          type="button"
          className={`gate-location-btn ${locationKind === 'ssh' ? 'active' : ''}`}
          onClick={() => { setLocationKind('ssh'); setDirectoryError(''); }}
        >
          SSH Remote
        </button>
      </div>

      {locationKind === 'local' ? (

      <div className="gate-input-container">
        <div className="gate-section-header">
          <span className="gate-section-label">Workspace</span>
          {baseDirectory && (
            <span className="gate-base-path" title={`Base: ${baseDirectory}`}>
              {baseDirectory}
            </span>
          )}
        </div>
        <div className="input-wrapper">
          <button
            className="cog-button cog-button-left"
            onClick={handleOpenBaseDirectory}
            disabled={isBaseLoading}
            title="Set base directory"
            aria-label="Set base directory"
          >
            {isBaseLoading ? (
              <Loader2 size={18} className="spin" />
            ) : (
              <Cog size={18} strokeWidth={2} />
            )}
          </button>
          <input
            ref={inputRef}
            type="text"
            className="gate-input"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setSelectedIndex(-1);
            }}
            onKeyDown={handleInputKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            placeholder="project name"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
          />
          <button
            className="cog-button"
            onClick={handleOpenDirectory}
            disabled={isLoading}
            title="Browse directories"
            aria-label="Browse directories"
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
                onMouseDown={(event) => event.preventDefault()}
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
      ) : (
      <div className="gate-input-container">
        <div className="gate-section-header">
          <span className="gate-section-label">SSH Remote Environment</span>
          <button
            type="button"
            className="gate-manage-ssh-link"
            onClick={() => {
              setShowSshManager(true);
              setSshSaveError('');
              setSshTestStatus(null);
            }}
          >
            Manage SSH Targets
          </button>
        </div>

        {sshEnvironments.length > 0 ? (
          <div className="ssh-env-picker">
            <select
              className="ssh-env-select"
              value={selectedSshEnvId}
              onChange={(e) => { setRemotePath(''); setDirectoryError(''); setSelectedSshEnvId(e.target.value); }}
            >
              {sshEnvironments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.label} ({env.target})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="ssh-no-environments">
            <span>No saved SSH environments.</span>
            <button
              type="button"
              className="gate-add-ssh-btn"
              onClick={() => {
                setShowSshManager(true);
                setSshSaveError('');
                setSshTestStatus(null);
              }}
            >
              + Add SSH Environment
            </button>
          </div>
        )}

        <div className="gate-section-header" style={{ marginTop: '10px' }}>
          <span className="gate-section-label">Remote Directory Path</span>
        </div>
        {selectedSshEnvId && (
          <RemoteWorkspacePath key={selectedSshEnvId} environmentId={selectedSshEnvId}
            path={remotePath} onPathChange={updateRemotePath} onSubmit={handleSubmit} />
        )}
      </div>
      )}
      {locationKind === 'local' && savedRecipes.length > 0 && (
        <div className="gate-recipes-section">
          <div className="gate-section-header">
            <span className="gate-section-label">Launch Recipes</span>
          </div>
          <div className="gate-recipes-chips">
            {savedRecipes.map((r) => (
              <button
                key={r.id}
                type="button"
                className="gate-recipe-chip"
                onClick={() => {
                  setSelectedRecipeForModal(r);
                  setShowRecipeModal(true);
                }}
                title={`Inspect & Launch "${r.name}" (${r.launches.length} steps)`}
              >
                <Play size={10} className="gate-recipe-chip-icon" />
                <span className="gate-recipe-chip-name">{r.name}</span>
                <span className="gate-recipe-chip-count">{r.launches.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="harness-selector">
        <div className="gate-section-header">
          <span className="gate-section-label">Harness</span>
          <button type="button" className="gate-settings-link" onClick={() => setWorkspaceMode('settings')}>
            <Settings size={12} strokeWidth={2} /> Configure
          </button>
        </div>
        <div className="harness-options">
          {HARNESS_OPTIONS.filter((harness) => visibleHarnessIds.includes(harness.id)).map((harness) => (
            <button
              key={harness.id}
              className={`harness-option ${selectedHarness === harness.id ? 'selected' : ''}`}
              onClick={() => handleHarnessChange(harness.id)}
              title={harness.id ? `Select ${harness.label}` : 'No harness (basic terminal)'}
            >
              <harness.Icon size={16} strokeWidth={2} className="harness-icon" />
              <span className="harness-label">{harness.label}</span>
            </button>
          ))}
        </div>
      </div>

      {showModelSelector && (
        <div className="model-picker">
          <span className="gate-section-label">Model</span>
          {selectedHarness === 'hermes' && modelOptions.length === 0 && (
            <button
              type="button"
              className="gate-model-refresh"
              onClick={() => void refreshHermesModels()}
              disabled={isRefreshingHermesModels}
            >
              {isRefreshingHermesModels ? 'Refreshing…' : 'Refresh Hermes models'}
            </button>
          )}
          {selectedHarness === 'hermes' && modelOptions.length === 0 ? (
            <input
              type="text"
              className="settings-select"
              aria-label="Hermes model"
              placeholder="Use Hermes default"
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
            />
          ) : (
          <>
          {/* Compact model pill */}
          <button
            type="button"
            className={`model-pill ${selectedHarness === 'hermes' ? 'hermes-model-pill' : ''}`}
            onClick={() => {
              setShowFavoritesPicker(true);
              setShowDiscoveryModal(false);
            }}
            title="Change model"
          >
            <span className={`model-pill-label ${selectedHarness === 'hermes' ? 'hermes-model-label' : ''} ${isModelUnresolved(defaultModel) ? 'unresolved' : ''}`}>
              {selectedHarness === 'hermes' && selectedModelOption
                ? <HermesModelName option={selectedModelOption} />
                : defaultModel
                  ? selectedModelOption?.label ?? defaultModel
                  : 'Default model'}
            </span>
            {isModelUnresolved(defaultModel) && (
              <AlertTriangle size={12} className="model-pill-warning" />
            )}
            <ChevronDown size={12} strokeWidth={2.5} className="model-pill-caret" />
          </button>
          {selectedHarness === 'hermes' && (
            <input
              type="text"
              className="settings-select"
              aria-label="Hermes model"
              placeholder="Enter custom model"
              value={modelOptions.some((model) => model.id === defaultModel) ? '' : defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
            />
          )}

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
                    {selectedHarness === 'hermes' && selectedModelOption
                      ? <HermesModelName option={selectedModelOption} />
                      : defaultModel
                        ? selectedModelOption?.label ?? 'Default model'
                        : 'No default set'}
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
                      <span className={`favorites-model-label ${selectedHarness === 'hermes' ? 'hermes-favorite-label' : ''}`}>
                        {model && selectedHarness === 'hermes' ? <HermesModelName option={model} /> : model?.label ?? favId}
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
              {selectedHarness === 'hermes' && (
                <button
                  type="button"
                  className="favorites-browse-link"
                  onClick={() => {
                    setDefaultModel(harnessDefaults?.hermes?.model ?? '');
                    setShowFavoritesPicker(false);
                  }}
                >
                  {harnessDefaults?.hermes?.model ? 'Use saved default' : 'Use Hermes default'}
                </button>
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
                {selectedHarness === 'hermes' && (
                  <button
                    type="button"
                    className="discovery-refresh"
                    onClick={() => void refreshHermesModels()}
                    disabled={isRefreshingHermesModels}
                  >
                    {isRefreshingHermesModels ? 'Refreshing…' : 'Refresh Hermes models'}
                  </button>
                )}
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
                        {selectedHarness === 'hermes' ? (
                          <span className="discovery-model-label hermes-model-label">
                            <HermesModelName option={model} />
                          </span>
                        ) : (
                          <span className="discovery-model-label">{model.label}</span>
                        )}
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
          </>
          )}
        </div>
      )}

      <div className="grid-selector">
        <span className="gate-section-label">Terminals</span>
        <div className="grid-options">
          {TERMINAL_PRESETS.map((preset, index) => (
            <button
              key={preset.count}
              className={`grid-option ${selectedPreset === index ? 'selected' : ''}`}
              onClick={() => setSelectedPreset(index)}
              title={`Press ${preset.label} to select`}
            >
              <span className="grid-label">{preset.label} terminal{preset.count > 1 ? 's' : ''}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="gate-launch-actions">
        <button className="gate-button" onClick={handleSubmit}>
          <Play size={14} strokeWidth={2.5} fill="currentColor" />
          Launch Workspace
        </button>
        <button className="gate-worktree-forward" type="button" aria-label="Worktree options" disabled={locationKind === 'ssh' || !worktreeReady} title={locationKind === 'ssh' ? 'Task worktrees are only available for local workspaces in this version' : worktreeReady ? 'Create or open a task worktree' : 'Choose a Git repository or linked checkout first'} onClick={() => {
          if (!inputValue.trim()) {
            if (activeWorkspacePath) setInputValue(activeWorkspacePath);
          }
          setHasViewedWorktree(true);
          setWorkspaceMode('worktree');
        }}>
          <GitBranch size={13} strokeWidth={2} />
          <span>Worktree</span>
        </button>
      </div>
      {directoryError && <p className="gate-directory-error" role="alert">{directoryError}</p>}
      {!isFocused && repoCandidatePath && repoCheck?.path === repoCandidatePath && !repoCheck.isRepo && (
        <p className="gate-worktree-hint">Worktrees require a Git repository or linked checkout.</p>
      )}
      </div>
      ) : workspaceMode === 'worktree' ? (
      <div className="gate-view gate-view-worktree">
        <button className="gate-worktree-back" type="button" onClick={() => setWorkspaceMode('directory')}>
          <ArrowLeft size={14} strokeWidth={2} /> Back to workspace
        </button>
        <div className="gate-worktree-heading">
          <GitBranch size={18} strokeWidth={2} />
          <div>
            <h2>Task worktree</h2>
            <p>Work on a separate branch and checkout.</p>
          </div>
        </div>
        <div className="gate-input-container">
          <div className="gate-section-header">
            <label className="gate-section-label" htmlFor="gate-worktree-repo">Repository</label>
            {baseDirectory && <span className="gate-base-path" title={`Base: ${baseDirectory}`}>{baseDirectory}</span>}
          </div>
          <div className="input-wrapper">
            <button className="cog-button cog-button-left" onClick={handleOpenBaseDirectory} disabled={isBaseLoading} title="Set base directory" aria-label="Set base directory">
              {isBaseLoading ? <Loader2 size={18} className="spin" /> : <Cog size={18} strokeWidth={2} />}
            </button>
            <input id="gate-worktree-repo" type="text" className="gate-input" value={inputValue} onChange={(event) => setInputValue(event.target.value)} placeholder="repository directory" spellCheck={false} autoComplete="off" autoCapitalize="off" />
            <button className="cog-button" onClick={handleOpenDirectory} disabled={isLoading} title="Browse repositories" aria-label="Browse repositories">
              {isLoading ? <Loader2 size={18} className="spin" /> : <FolderOpen size={18} strokeWidth={2} />}
            </button>
          </div>
        </div>
        <WorktreeLauncher repoPath={selectedPath} openPaths={openPaths} onOpenPath={launchPath} />
        <p className="gate-worktree-launch-summary">Opens with {selectedHarness ? HARNESS_OPTIONS.find((option) => option.id === selectedHarness)?.label ?? selectedHarness : 'Terminal'} · {TERMINAL_PRESETS[selectedPreset].count} terminals</p>
      </div>
      ) : (
        <GateHarnessSettings
          selectedHarness={selectedHarness}
          onSelectHarness={setSelectedHarness}
          onBack={returnFromSettings}
        />
      )}
      <RecipeModal
        isOpen={showRecipeModal}
        onClose={() => setShowRecipeModal(false)}
        initialRecipe={selectedRecipeForModal}
        defaultWorkspacePath={selectedPath ?? inputValue}
        workspaceEnvironmentId={locationKind === 'ssh' ? selectedSshEnvId || 'ssh' : 'local'}
        onLaunchRecipe={async (recipe) => {
          if (onLaunchRecipe) {
            return onLaunchRecipe(recipe);
          }
          const harnessStep = recipe.launches.find((l) => l.type === 'harness');
          onSubmit({
            path: recipe.workspacePath,
            terminalCount: recipe.terminalCount ?? (recipe.launches.length || 1),
            harness: harnessStep?.harnessId ?? '',
            model: harnessStep?.modelId,
          });
        }}
        onRecipeSaved={(saved) => {
          setSavedRecipes((prev) => {
            const idx = prev.findIndex((p) => p.id === saved.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = saved;
              return copy;
            }
            return [...prev, saved];
          });
        }}
        onRecipeDeleted={(id) => {
          setSavedRecipes((prev) => prev.filter((p) => p.id !== id));
        }}
      />
      {showSshManager && (
        <div className="ssh-manager-overlay" onClick={() => setShowSshManager(false)}>
          <div className="ssh-manager-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ssh-manager-header">
              <span className="ssh-manager-title">Manage SSH Targets</span>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowSshManager(false)}
                title="Close"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <div className="ssh-manager-body">
              <div className="ssh-manager-form">
                <span className="gate-section-label">Add New SSH Environment</span>
                <div className="ssh-form-row">
                  <label>Label</label>
                  <input
                    type="text"
                    className="ssh-form-input"
                    value={sshFormLabel}
                    onChange={(e) => setSshFormLabel(e.target.value)}
                    placeholder="e.g. dev-vps"
                  />
                </div>
                <div className="ssh-form-row">
                  <label>SSH Target</label>
                  <input
                    type="text"
                    className="ssh-form-input"
                    value={sshFormTarget}
                    onChange={(e) => {
                      setSshFormTarget(e.target.value);
                      setSshTestStatus(null);
                    }}
                    placeholder="e.g. user@192.168.1.100 or vps-host"
                  />
                </div>
                {sshTestStatus && (
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: '12px',
                      color: sshTestStatus.success ? 'var(--accent-success, #98c379)' : 'var(--accent-error, #e06c75)',
                    }}
                  >
                    {sshTestStatus.message}
                  </p>
                )}
                {sshSaveError && (
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--accent-error, #e06c75)' }}>
                    {sshSaveError}
                  </p>
                )}
                <div className="ssh-form-actions">
                  <button
                    type="button"
                    className="ssh-btn-test"
                    onClick={handleTestSsh}
                    disabled={isTestingSsh}
                  >
                    {isTestingSsh ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button
                    type="button"
                    className="ssh-btn-save"
                    onClick={handleSaveSshEnv}
                  >
                    Save Target
                  </button>
                </div>
              </div>

              <div className="ssh-saved-list">
                <span className="gate-section-label" style={{ display: 'block', marginBottom: '8px' }}>
                  Saved Environments ({sshEnvironments.length})
                </span>
                {sshEnvironments.length === 0 ? (
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>No saved SSH environments yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {sshEnvironments.map((env) => (
                      <div key={env.id} className="ssh-env-item">
                        <div className="ssh-env-info">
                          <span className="ssh-env-label">{env.label}</span>
                          <span className="ssh-env-target">{env.target}</span>
                        </div>
                        <button
                          type="button"
                          className="ssh-env-delete-btn"
                          onClick={() => handleDeleteSshEnv(env.id)}
                          title="Delete environment"
                        >
                          <X size={14} strokeWidth={2} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
