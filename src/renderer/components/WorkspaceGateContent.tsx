import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FolderOpen, Folder, Loader2, Play, ChevronRight, AlertTriangle, Cog, GitBranch, ArrowLeft } from 'lucide-react';
import type { WorkspaceRecipe, RecipeLaunchResult } from '../../shared/types/recipes';
import type { SshEnvironmentConfig } from '../../shared/types/environments';
import { HARNESS_OPTIONS, resolveAvailableHarnessIds, resolveVisibleHarnessIds } from '../lib/harnessOptions';
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
import SshEnvironmentManager from './SshEnvironmentManager';
import RemoteWorktreePicker from './RemoteWorktreePicker';
import { GateLaunchActions, GateWorktreeAction } from './gate/GateLaunchActions';
import { WorkspaceTargetPicker } from './gate/WorkspaceTargetPicker';
import { HarnessLaunchList } from './gate/HarnessLaunchList';
import { recipeTerminalCounts, type WorkspaceTerminalLaunch } from '../lib/workspaceLaunchPlan';
import './WorkspaceGate.css';
import './WorkspaceLauncher.css';

export interface WorkspaceFormData {
  path: string;
  terminalCount: number;
  harness: string;
  model?: string;
  terminalLaunches?: WorkspaceTerminalLaunch[];
  environmentId?: string;
  environmentLabel?: string;
}

interface ContentProps {
  /** Controls branding only; the launcher form is identical in both shells. */
  fullscreen?: boolean;
  opening?: boolean;
  launchingRecipeId?: string;
  initialPath?: string;
  onSubmit: (data: WorkspaceFormData) => void;
  onLaunchRecipe?: (recipe: WorkspaceRecipe) => Promise<RecipeLaunchResult | null | void>;
  openError?: string;
  onTargetChange?: () => void;
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
  if (!trimmed) return baseDirectory ? withTrailingSlash(baseDirectory) : null;
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


export default function WorkspaceGateContent({ initialPath, onSubmit, onLaunchRecipe, openError, onTargetChange, fullscreen = true, opening = false, launchingRecipeId }: ContentProps) {
  const [savedRecipes, setSavedRecipes] = useState<WorkspaceRecipe[]>([]);
  const [inputValue, setInputValue] = useState(initialPath || '');
  const [baseDirectory, setBaseDirectory] = useState<string>('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [isBaseLoading, setIsBaseLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [terminalCounts, setTerminalCounts] = useState<Record<string, number> | null>(null);
  const [recipePreset, setRecipePreset] = useState<string | null>(null);
  const [selectedHarness, setSelectedHarness] = useState('codex'); // Default to codex
  const [availableHarnessIds, setAvailableHarnessIds] = useState<string[]>(['']);
  const [hasLoadedHarnessOptions, setHasLoadedHarnessOptions] = useState(false);
  const [harnessDefaults, setHarnessDefaults] = useState<HarnessDefaultsMap | null>(null);
  const [allModels, setAllModels] = useState<Record<string, ModelOption[]>>({});
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [isRefreshingHermesModels, setIsRefreshingHermesModels] = useState(false);
  const refreshedHermesModelsRef = useRef<ModelOption[] | null>(null);
  const [modelOverrides, setModelOverrides] = useState<Record<string, string>>({});
  const [locationKind, setLocationKind] = useState<'local' | 'ssh'>('local');
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
  const repoCandidatePath = selectedPath;
  const worktreeReady = !!repoCandidatePath && repoCheck?.path === repoCandidatePath && repoCheck.isRepo;
  const [sshEnvironments, setSshEnvironments] = useState<SshEnvironmentConfig[]>([]);
  const [selectedSshEnvId, setSelectedSshEnvId] = useState<string>('');
  const selectedSshEnvironment = sshEnvironments.find((environment) => environment.id === selectedSshEnvId);
  const selectedSshTarget = locationKind === 'ssh'
    ? selectedSshEnvironment?.target
    : undefined;
  const remoteRepositories = openWorkspaces.filter((workspace) => workspace.environmentId === selectedSshEnvId);
  const [remotePath, setRemotePath] = useState('');
  const remoteLocationKey = JSON.stringify([selectedSshEnvId, selectedSshEnvironment]);
  const [remoteBase, setRemoteBase] = useState<{ key: string; path: string } | null>(null);
  const remoteBaseDirectory = remoteBase?.key === remoteLocationKey ? remoteBase?.path ?? '' : '';
  const updateRemoteBaseDirectory = useCallback((path: string) => {
    setRemoteBase({ key: remoteLocationKey, path });
  }, [remoteLocationKey]);
  const updateRemotePath = useCallback((path: string) => {
    setRemotePath(path);
    setDirectoryError('');
  }, []);
  const [showSshManager, setShowSshManager] = useState(false);
  const [editingSshEnvId, setEditingSshEnvId] = useState<string | null>(null);

  useEffect(() => {
    onTargetChange?.();
  }, [locationKind, inputValue, baseDirectory, selectedSshEnvId, remotePath, onTargetChange]);

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

  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionRequestRef = useRef(0);
  const launchRequestRef = useRef(0);
  const visibleHarnessIds = useMemo(
    () => resolveVisibleHarnessIds(availableHarnessIds, harnessDefaults),
    [availableHarnessIds, harnessDefaults],
  );

  const favoriteSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const toggleFavorite = useCallback(
    (harnessId: string, modelId: string) => {
      // Changing harness menus must not race another read-modify-write of defaults.
      const save = favoriteSaveQueue.current.catch(() => {}).then(async () => {
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
      });
      favoriteSaveQueue.current = save;
      return save;
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
        // Use harness-owned defaults when settings are unavailable.
      });
    return () => { cancelled = true; };
  }, []);

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
    setTerminalCounts(null);
    setRecipePreset(null);
    setHasLoadedHarnessOptions(false);
    setModelsLoaded(false);
    if (locationKind === 'ssh') {
      setAvailableHarnessIds(['']);
      setSelectedHarness('');
    }
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
          setSelectedHarness((current) => current && availableIds.includes(current) ? current : (availableIds.find((id) => id !== '') ?? ''));
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
  }, [locationKind, selectedSshEnvId, selectedSshTarget]);

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
    setTerminalCounts((counts) => counts ? { [harness]: visibleHarnessIds.reduce((sum, id) => sum + (counts[id] ?? 0), 0) } : null);
    setRecipePreset(null);
    setSelectedHarness(harness);
  }, [visibleHarnessIds]);

  useEffect(() => {
    const handleLauncherShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
        || isEditableEventTarget(event.target)) return;

      const key = event.key.toLowerCase();
      let handler: (() => void) | undefined;
      if (key === '1') handler = () => { setTerminalCounts({ [selectedHarness]: 1 }); setRecipePreset(null); };
      else if (key === '2') handler = () => { setTerminalCounts({ [selectedHarness]: 2 }); setRecipePreset(null); };
      else if (key === '4') handler = () => { setTerminalCounts({ [selectedHarness]: 4 }); setRecipePreset(null); };
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

  const counts = terminalCounts ?? {};
  const launchHarnessOptions = useMemo(() => HARNESS_OPTIONS
    .filter((option) => visibleHarnessIds.includes(option.id))
    .sort((a, b) => Number(a.id === '') - Number(b.id === '')), [visibleHarnessIds]);
  const rowModels = Object.fromEntries(visibleHarnessIds.map((id) => [id,
    modelOverrides[id] ?? (harnessDefaults?.[id]?.model || (id === 'hermes' ? '' : allModels[id]?.[0]?.id ?? '')),
  ]));
  const terminalLaunches: WorkspaceTerminalLaunch[] = launchHarnessOptions.flatMap(({ id: harness }) =>
    Array.from({ length: counts[harness] ?? 0 }, () => ({ harness, model: locationKind === 'local' && harness ? rowModels[harness] || undefined : undefined })),
  );

  const launchPath = (path: string, envId = 'local', envLabel = 'Local') => {
    if (!hasLoadedHarnessOptions || !terminalLaunches.length) return;
    const first = terminalLaunches.find((launch) => launch.harness) ?? terminalLaunches[0];
    onSubmit({ path, terminalCount: terminalLaunches.length, harness: first.harness, model: first.model,
      terminalLaunches, environmentId: envId, environmentLabel: envLabel });
  };

  const handleSubmit = () => {
    if (opening || (!hasLoadedHarnessOptions || !terminalLaunches.length)) return;
    if (locationKind === 'ssh') {
      if (!hasLoadedHarnessOptions) return;
      if (!selectedSshEnvId) {
        setDirectoryError('Please select or add an SSH environment first');
        return;
      }
      const trimmed = remotePath.trim() || remoteBaseDirectory;
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
  const worktreeActionProps = {
    worktreeDisabled: opening || !terminalLaunches.length || (locationKind === 'ssh' ? !remoteRepositories.length : !worktreeReady),
    worktreeTitle: locationKind === 'ssh' ? 'Discover worktrees from an open repository on this SSH target' : worktreeReady ? 'Create or open a task worktree' : 'Choose a Git repository or linked checkout first',
    onWorktree: () => {
      setHasViewedWorktree(true);
      setWorkspaceMode('worktree');
    },
  };

  const targetPicker = <WorkspaceTargetPicker
    value={locationKind === 'local' ? 'local' : selectedSshEnvId}
    environments={sshEnvironments} localRoot={baseDirectory} settingsBusy={isBaseLoading} disabled={opening}
    onSelect={(id) => {
      setLocationKind(id === 'local' ? 'local' : 'ssh');
      if (id !== 'local' && id !== selectedSshEnvId) {
        setRemotePath('');
        setSelectedSshEnvId(id);
      }
      setDirectoryError('');
    }}
    onAddServer={() => { setEditingSshEnvId(null); setShowSshManager(true); }}
    onSettings={() => {
      if (locationKind === 'local') void handleOpenBaseDirectory();
      else { setEditingSshEnvId(selectedSshEnvId); setShowSshManager(true); }
    }}
  />;

  return (
    <div className="gate-content workspace-launcher">
      {workspaceMode === 'directory' ? (
      <div className={`gate-view gate-view-directory ${hasViewedWorktree ? 'gate-view-return' : ''}`}>
      {fullscreen && <div className="gate-header">
        <img src="./robot-icon.png" alt="Clanker Grid" width="64" height="64" className="gate-brand-icon" />
        <h1 className="gate-title">Clanker Grid</h1>
        <p className="gate-subtitle">Developer Workspace Launcher</p>
      </div>}

      <div className="gate-workspace-chooser">
      <div className="gate-section-header">
        <div className="gate-directory-actions">
          {targetPicker}
          <GateWorktreeAction {...worktreeActionProps} />
        </div>
        {(locationKind === 'local' ? baseDirectory : remoteBaseDirectory) &&
          <span className="gate-base-path" title="Starting directory">{locationKind === 'local' ? baseDirectory : withTrailingSlash(remoteBaseDirectory)}</span>}
      </div>
      {locationKind === 'local' ? (

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
            onKeyDown={handleInputKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            placeholder="workspace directory"
            aria-label="Workspace directory"
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
        {selectedSshEnvId && (
          <RemoteWorkspacePath key={remoteLocationKey} environmentId={selectedSshEnvId}
            relativeToBase onBaseDirectoryChange={updateRemoteBaseDirectory}
            path={remotePath} onPathChange={updateRemotePath} onSubmit={handleSubmit} />
        )}
      </div>
      )}
      </div>
      {locationKind === 'local' && savedRecipes.length > 0 && (
        <div className="gate-recipes-section" role="group" aria-label="Launch recipes">
          <div className="gate-recipes-chips">
            {savedRecipes.map((r) => (
              <div key={r.id} className="gate-recipe-preset">
              <button
                type="button"
                className="gate-recipe-chip"
                aria-pressed={recipePreset === r.id}
                disabled={opening || !hasLoadedHarnessOptions}
                onClick={() => {
                  try {
                    setTerminalCounts(recipeTerminalCounts(r, visibleHarnessIds));
                    setRecipePreset(r.id);
                    setDirectoryError('');
                  } catch (error) { setDirectoryError(error instanceof Error ? error.message : 'Could not apply recipe counts.'); }
                }}
                title={`Fill terminal counts from "${r.name}"; commands, paths and browser settings are not applied`}
              >
                <span className="gate-recipe-chip-name">{r.name}</span>
                <span className="gate-recipe-chip-count">{Math.max(r.launches.length, r.terminalCount ?? 0, 1)}</span>
              </button>
              <button type="button" className="gate-recipe-play" disabled={opening || !onLaunchRecipe}
                aria-label={`Launch recipe ${r.name}`} aria-busy={launchingRecipeId === r.id}
                title={`Launch "${r.name}" in ${r.workspacePath}`}
                onClick={() => { void onLaunchRecipe?.(r); }}>
                {launchingRecipeId === r.id ? <Loader2 size={11} className="spin" aria-hidden="true" /> : <Play size={11} fill="currentColor" aria-hidden="true" />}
              </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <HarnessLaunchList
        options={launchHarnessOptions}
        counts={counts} models={allModels} modelsLoading={!modelsLoaded} selectedModels={rowModels} defaults={harnessDefaults}
        remote={locationKind === 'ssh'} disabled={opening || !hasLoadedHarnessOptions} refreshing={isRefreshingHermesModels}
        onCount={(harness, count) => { setTerminalCounts({ ...counts, [harness]: count }); setRecipePreset(null); }}
        onModel={(harness, model) => setModelOverrides((previous) => ({ ...previous, [harness]: model }))}
        onFavorite={toggleFavorite}
        onRefresh={() => { void refreshHermesModels(); }}
      />

      <GateLaunchActions showWorktree={false} onLaunch={handleSubmit} opening={opening} launchDisabled={(!hasLoadedHarnessOptions || !terminalLaunches.length) || locationKind === 'local' && !selectedPath || locationKind === 'ssh' && (!hasLoadedHarnessOptions || (!remoteBaseDirectory && !remotePath.startsWith('/')))}
        {...worktreeActionProps} />
      <div className="gate-settings-footer">
        <button type="button" className="gate-settings-link" disabled={opening} onClick={() => setWorkspaceMode('settings')}>
          <Cog size={12} aria-hidden="true" /> Settings
        </button>
      </div>
      {openError && (
        <p className="gate-open-error" role="alert">
          <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
          <span>{openError}</span>
        </p>
      )}
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
            <h2>{locationKind === 'ssh' ? 'Open remote worktree' : 'Task worktree'}</h2>
            <p>{locationKind === 'ssh' ? `Choose an existing checkout on ${sshEnvironments.find((env) => env.id === selectedSshEnvId)?.label ?? 'this SSH target'}.` : 'Work on a separate branch and checkout.'}</p>
          </div>
        </div>
        {locationKind === 'ssh' ? <RemoteWorktreePicker
          key={selectedSshEnvId}
          repositories={remoteRepositories}
          preferredWorkspaceId={activeWorkspaceId}
          launchReady={hasLoadedHarnessOptions}
          onOpenPath={(path) => launchPath(path, selectedSshEnvId, sshEnvironments.find((env) => env.id === selectedSshEnvId)?.label ?? 'Remote')}
        /> : <>
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
        </>}
        <p className="gate-worktree-launch-summary">Opens with {launchHarnessOptions.filter((option) => counts[option.id]).map((option) => `${counts[option.id]} ${option.label}`).join(' · ')} · {terminalLaunches.length} terminals</p>
      </div>
      ) : (
        <GateHarnessSettings
          selectedHarness={selectedHarness}
          onSelectHarness={setSelectedHarness}
          onBack={returnFromSettings}
        />
      )}
      {showSshManager && <SshEnvironmentManager
        environments={sshEnvironments}
        initialEnvironment={sshEnvironments.find((env) => env.id === editingSshEnvId)}
        onClose={() => setShowSshManager(false)}
        onSaved={(config) => {
          setSshEnvironments((previous) => [...previous.filter((env) => env.id !== config.id), config]);
          setRemotePath('');
          setSelectedSshEnvId(config.id);
          setLocationKind('ssh'); setShowSshManager(false);
        }}
        onDeleted={(id) => {
          const remaining = sshEnvironments.filter((env) => env.id !== id);
          setSshEnvironments(remaining);
          if (selectedSshEnvId === id) {
            setRemotePath(''); setSelectedSshEnvId(remaining[0]?.id ?? '');
            setLocationKind('local'); setShowSshManager(false);
          }
        }}
      />}

    </div>
  );
}
