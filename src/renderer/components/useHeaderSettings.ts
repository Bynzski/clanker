import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AI_COMMIT_PROVIDER_IDS,
  HARNESS_OPTIONS,
  resolveAvailableHarnessIds,
  resolveVisibleHarnessIds,
} from '../lib/harnessOptions';
import { notifyUsagePreferenceSaved } from '../lib/settingsHandoff';
import type { HarnessDefaultsMap } from '../../shared/types/store';
import type { ModelOption } from '../types/shared';

interface UseHeaderSettingsOptions {
  harness: string;
  setHarness: (harnessId: string) => void;
  includeAiCommit?: boolean;
  environmentId?: string;
  validateHarness?: boolean;
}

export function useHeaderSettings({ harness, setHarness, includeAiCommit = true, validateHarness = true, environmentId = 'local' }: UseHeaderSettingsOptions) {
  // Discovery is owned by an environment *transition* (epoch), not just an environment id, so a
  // result left over from an earlier visit to the same environment never counts as the current one.
  // The epoch is bumped during render, before any stale result could be read for the new environment.
  const [transition, setTransition] = useState({ environmentId, epoch: 0 });
  if (transition.environmentId !== environmentId) {
    setTransition({ environmentId, epoch: transition.epoch + 1 });
  }
  const epoch = transition.epoch;
  const liveEpoch = useRef(epoch);
  liveEpoch.current = epoch;
  const [discovery, setDiscovery] = useState<{ epoch: number; status: 'ready' | 'failed'; ids: string[] } | null>(null);
  const currentDiscovery = discovery?.epoch === epoch && transition.environmentId === environmentId ? discovery : null;
  /** 'loading' until the current transition's own discovery answers. */
  const harnessDiscoveryStatus: 'loading' | 'ready' | 'failed' = currentDiscovery?.status ?? 'loading';
  // Fail-closed for availability consumers (Usage, launcher): only a successful current discovery exposes ids.
  const availableHarnessIds = useMemo(
    () => (currentDiscovery?.status === 'ready' ? currentDiscovery.ids : ['']),
    [currentDiscovery],
  );
  const [aiCommitEnabled, setAiCommitEnabled] = useState(false);
  const [aiCommitProvider, setAiCommitProvider] = useState<string>('');
  const [aiCommitModel, setAiCommitModel] = useState('');
  const [aiCommitModels, setAiCommitModels] = useState<ModelOption[]>([]);
  const [isLoadingAiCommitModels, setIsLoadingAiCommitModels] = useState(false);
  const [aiCommitModelsError, setAiCommitModelsError] = useState('');
  const [hasLoadedAiCommitSettings, setHasLoadedAiCommitSettings] = useState(false);
  const [harnessDefaults, setHarnessDefaultsState] = useState<HarnessDefaultsMap | null>(null);
  /** Persisted preferences (e.g. Show in Usage) are only trustworthy once this is 'ready'. */
  const [harnessDefaultsStatus, setHarnessDefaultsStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [settingsError, setSettingsError] = useState('');
  const [harnessModelError, setHarnessModelError] = useState<Record<string, string>>({});
  const [expandedHarness, setExpandedHarness] = useState<string | null>(null);
  const [harnessModelCache, setHarnessModelCache] = useState<Record<string, ModelOption[]>>({});
  const [harnessModelLoading, setHarnessModelLoading] = useState<Record<string, boolean>>({});
  const visibleHarnessIds = useMemo(
    () => resolveVisibleHarnessIds(availableHarnessIds, harnessDefaults),
    [availableHarnessIds, harnessDefaults],
  );

  useEffect(() => {
    setHarnessModelCache({});
    setHarnessModelLoading({});
    setHarnessModelError({});
  }, [environmentId]);

  useEffect(() => {
    let cancelled = false;

    const loadHarnessOptions = async () => {
      try {
        const options = environmentId === 'local'
          ? await window.electronAPI.getHarnessOptions()
          : await window.electronAPI.getEnvironmentHarnessOptions(environmentId);
        if (cancelled) return;
        setDiscovery({ epoch, status: 'ready', ids: resolveAvailableHarnessIds(options) });
      } catch {
        if (!cancelled) {
          setDiscovery({ epoch, status: 'failed', ids: [''] });
        }
      }
    };

    void loadHarnessOptions();

    return () => {
      cancelled = true;
    };
  }, [environmentId, epoch]);

  useEffect(() => {
    // Selection is only judged by a successful discovery of the current environment: pending or failed
    // discovery proves nothing, and clearing would also wipe the workspace's model.
    if (!validateHarness || harnessDiscoveryStatus !== 'ready') return;
    if (harness && !visibleHarnessIds.includes(harness)) {
      setHarness('');
    }
  }, [harness, setHarness, visibleHarnessIds, validateHarness, harnessDiscoveryStatus]);

  useEffect(() => {
    if (!includeAiCommit) return;
    const loadSettings = async () => {
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
    void loadSettings();
  }, [includeAiCommit]);

  useEffect(() => {
    const loadHarnessDefaults = async () => {
      try {
        const defaults = await window.electronAPI.getHarnessDefaults();
        setHarnessDefaultsState(defaults);
        setHarnessDefaultsStatus('ready');
      } catch (err) {
        console.error('Failed to load harness defaults:', err);
        setHarnessDefaultsStatus('failed');
      }
    };
    void loadHarnessDefaults();
  }, []);

  useEffect(() => {
    if (!hasLoadedAiCommitSettings) return;

    let cancelled = false;

    const loadAiCommitModels = async () => {
      setAiCommitModelsError('');
      if (!aiCommitProvider || !availableHarnessIds.includes(aiCommitProvider)) {
        setAiCommitModels([]);
        setIsLoadingAiCommitModels(false);
        return;
      }

      setIsLoadingAiCommitModels(true);
      try {
        const models = await window.electronAPI.getHarnessModels(aiCommitProvider);
        if (cancelled) return;

        setAiCommitModels(models);
      } catch (error) {
        console.error('Failed to load AI commit models:', error);
        if (!cancelled) {
          setAiCommitModels([]);
          setAiCommitModelsError('Could not load provider models. The saved model is preserved.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingAiCommitModels(false);
        }
      }
    };

    void loadAiCommitModels();

    return () => {
      cancelled = true;
    };
  }, [aiCommitProvider, availableHarnessIds, hasLoadedAiCommitSettings]);

  const handleToggleAiCommit = async (checked: boolean) => {
    setSettingsError('');
    try {
      await window.electronAPI.setAiCommitEnabled(checked);
      setAiCommitEnabled(checked);
    } catch (err) {
      setSettingsError('Could not save AI commit setting.');
      console.error('Failed to save AI commit setting:', err);
    }
  };

  const handleAiCommitProviderChange = async (provider: string) => {
    setSettingsError('');
    try {
      await window.electronAPI.setAiCommitProvider(provider);
      setAiCommitProvider(provider);
      setAiCommitModel('');
      await window.electronAPI.setAiCommitModel('');
    } catch (err) {
      setSettingsError('Could not save AI commit provider.');
      console.error('Failed to save AI commit provider:', err);
    }
  };

  const handleAiCommitModelChange = async (model: string) => {
    setSettingsError('');
    try {
      await window.electronAPI.setAiCommitModel(model);
      setAiCommitModel(model);
    } catch (err) {
      setSettingsError('Could not save AI commit model.');
      console.error('Failed to save AI commit model:', err);
    }
  };

  const handleSetHarnessFlags = async (harnessId: string, flags: string) => {
    setSettingsError('');
    if (!harnessDefaults) return;
    const newDefaults = {
      ...harnessDefaults,
      [harnessId]: {
        ...harnessDefaults[harnessId],
        flags,
      },
    };
    setHarnessDefaultsState(newDefaults);
    try {
      await window.electronAPI.setHarnessDefaults(newDefaults);
    } catch (err) {
      setSettingsError('Could not save harness flags.');
      console.error('Failed to save harness flags:', err);
    }
  };

  const handleSetHarnessVisible = async (harnessId: string, visible: boolean) => {
    setSettingsError('');
    if (!harnessDefaults) return;
    const newDefaults = {
      ...harnessDefaults,
      [harnessId]: {
        ...harnessDefaults[harnessId],
        visible,
      },
    };
    setHarnessDefaultsState(newDefaults);
    if (!visible && harness === harnessId) {
      setHarness('');
    }
    try {
      await window.electronAPI.setHarnessDefaults(newDefaults);
    } catch (err) {
      setSettingsError('Could not save harness visibility.');
      console.error('Failed to save harness visibility:', err);
    }
  };

  const handleSetHarnessAttention = async (harnessId: string, attentionEnabled: boolean) => {
    setSettingsError('');
    if (!harnessDefaults) return;
    const newDefaults = {
      ...harnessDefaults,
      [harnessId]: { ...harnessDefaults[harnessId], attentionEnabled },
    };
    setHarnessDefaultsState(newDefaults);
    try {
      await window.electronAPI.setHarnessDefaults(newDefaults);
    } catch (err) {
      setSettingsError('Could not save agent attention setting.');
      console.error('Failed to save agent attention setting:', err);
    }
  };

  const handleSetHarnessAgentBridge = async (harnessId: string, agentBridgeEnabled: boolean) => {
    setSettingsError('');
    if (!harnessDefaults) return;
    const newDefaults = {
      ...harnessDefaults,
      [harnessId]: { ...harnessDefaults[harnessId], agentBridgeEnabled },
    };
    setHarnessDefaultsState(newDefaults);
    try {
      await window.electronAPI.setHarnessDefaults(newDefaults);
    } catch (err) {
      setSettingsError('Could not save Clanker bridge setting.');
      console.error('Failed to save Clanker bridge setting:', err);
    }
  };

  const handleSetHarnessUsageVisible = async (harnessId: string, usageVisible: boolean) => {
    setSettingsError('');
    if (!harnessDefaults) return;
    const newDefaults = {
      ...harnessDefaults,
      [harnessId]: { ...harnessDefaults[harnessId], usageVisible },
    };
    setHarnessDefaultsState(newDefaults);
    try {
      await window.electronAPI.setHarnessDefaults(newDefaults);
      notifyUsagePreferenceSaved();
    } catch (err) {
      setSettingsError('Could not save Usage visibility.');
      console.error('Failed to save usage visibility:', err);
    }
  };

  const handleSetDefaultModel = async (harnessId: string, modelId: string) => {
    setSettingsError('');
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
      setSettingsError('Could not save default model.');
      console.error('Failed to save default model:', err);
    }
  };

  const handleToggleFavorite = async (harnessId: string, modelId: string) => {
    setSettingsError('');
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
      // A newer full preference snapshot may already have saved these favorites.
      setHarnessDefaultsState((current) => current === newDefaults ? harnessDefaults : current);
      setSettingsError('Could not save model favorites.');
      console.error('Failed to save harness favorites:', err);
      throw err;
    }
  };

  const loadHarnessModels = async (harnessId: string, refresh = false) => {
    if (environmentId !== 'local') {
      setHarnessModelCache((prev) => ({ ...prev, [harnessId]: [] }));
      return;
    }
    if (harnessModelLoading[harnessId] || (!refresh && harnessModelCache[harnessId] !== undefined)) return;
    const owner = epoch;
    setHarnessModelError((prev) => ({ ...prev, [harnessId]: '' }));
    setHarnessModelLoading((prev) => ({ ...prev, [harnessId]: true }));
    try {
      const models = refresh && harnessId === 'hermes'
        ? await window.electronAPI.getHarnessModels(harnessId, true)
        : await window.electronAPI.getHarnessModels(harnessId);
      if (liveEpoch.current !== owner) return;
      setHarnessModelCache((prev) => ({ ...prev, [harnessId]: models }));
    } catch (err) {
      if (liveEpoch.current !== owner) return;
      console.error(`Failed to load models for ${harnessId}:`, err);
      setHarnessModelError((prev) => ({ ...prev, [harnessId]: 'Could not load models. Retry to refresh the catalog.' }));
      if (!refresh) setHarnessModelCache((prev) => ({ ...prev, [harnessId]: [] }));
    } finally {
      if (liveEpoch.current === owner) setHarnessModelLoading((prev) => ({ ...prev, [harnessId]: false }));
    }
  };

  const aiCommitProviderOptions = useMemo(
    () => HARNESS_OPTIONS
      .filter((option) => option.id !== '' && AI_COMMIT_PROVIDER_IDS.includes(option.id as (typeof AI_COMMIT_PROVIDER_IDS)[number]))
      .filter((option) => availableHarnessIds.includes(option.id) || option.id === aiCommitProvider)
      .map((option) => availableHarnessIds.includes(option.id) ? option : { ...option, label: `${option.label} (unavailable)` }),
    [availableHarnessIds, aiCommitProvider],
  );

  return {
    settingsError,
    harnessModelError,
    harnessDefaultsStatus,
    harnessDiscoveryStatus,
    availableHarnessIds,
    visibleHarnessIds,
    aiCommitEnabled,
    aiCommitProvider,
    aiCommitModel,
    aiCommitModels,
    isLoadingAiCommitModels,
    aiCommitModelsError,
    harnessDefaults,
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
  };
}
