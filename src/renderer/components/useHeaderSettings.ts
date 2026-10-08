import { useEffect, useMemo, useState } from 'react';
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
  const [discovery, setDiscovery] = useState<{ epoch: number; status: 'ready' | 'failed'; ids: string[] } | null>(null);
  const currentDiscovery = discovery?.epoch === epoch && transition.environmentId === environmentId ? discovery : null;
  /** 'loading' until the current transition's own discovery answers. */
  const harnessDiscoveryStatus: 'loading' | 'ready' | 'failed' = currentDiscovery?.status ?? 'loading';
  // Fail-closed for availability consumers (Usage, launcher): only a successful current discovery exposes ids.
  const availableHarnessIds = useMemo(
    () => (currentDiscovery?.status === 'ready' ? currentDiscovery.ids : ['']),
    [currentDiscovery],
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [aiCommitEnabled, setAiCommitEnabled] = useState(false);
  const [aiCommitProvider, setAiCommitProvider] = useState<string>('');
  const [aiCommitModel, setAiCommitModel] = useState('');
  const [aiCommitModels, setAiCommitModels] = useState<ModelOption[]>([]);
  const [isLoadingAiCommitModels, setIsLoadingAiCommitModels] = useState(false);
  const [hasLoadedAiCommitSettings, setHasLoadedAiCommitSettings] = useState(false);
  const [harnessDefaults, setHarnessDefaultsState] = useState<HarnessDefaultsMap | null>(null);
  /** Persisted preferences (e.g. Show in Usage) are only trustworthy once this is 'ready'. */
  const [harnessDefaultsStatus, setHarnessDefaultsStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [expandedHarness, setExpandedHarness] = useState<string | null>(null);
  const [harnessModelCache, setHarnessModelCache] = useState<Record<string, ModelOption[]>>({});
  const [harnessModelLoading, setHarnessModelLoading] = useState<Record<string, boolean>>({});
  const visibleHarnessIds = useMemo(
    () => resolveVisibleHarnessIds(availableHarnessIds, harnessDefaults),
    [availableHarnessIds, harnessDefaults],
  );

  useEffect(() => {
    setHarnessModelCache({});
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

    const availableProviders = HARNESS_OPTIONS
      .filter((option) => option.id !== '' && AI_COMMIT_PROVIDER_IDS.includes(option.id as (typeof AI_COMMIT_PROVIDER_IDS)[number]))
      .map((option) => option.id)
      .filter((id) => availableHarnessIds.includes(id));

    if (availableProviders.length === 0) return;

    if (!aiCommitProvider || !availableProviders.includes(aiCommitProvider)) {
      const nextProvider = availableProviders[0];
      setAiCommitProvider(nextProvider);
      void window.electronAPI.setAiCommitProvider(nextProvider);
      setAiCommitModel('');
      void window.electronAPI.setAiCommitModel('');
    }
  }, [availableHarnessIds, aiCommitProvider, hasLoadedAiCommitSettings]);

  useEffect(() => {
    if (!hasLoadedAiCommitSettings) return;

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

    void loadAiCommitModels();

    return () => {
      cancelled = true;
    };
  }, [aiCommitProvider, availableHarnessIds, hasLoadedAiCommitSettings]);

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

  const handleSetHarnessFlags = async (harnessId: string, flags: string) => {
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
      console.error('Failed to save harness flags:', err);
    }
  };

  const handleSetHarnessVisible = async (harnessId: string, visible: boolean) => {
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
      console.error('Failed to save harness visibility:', err);
    }
  };

  const handleSetHarnessAttention = async (harnessId: string, attentionEnabled: boolean) => {
    if (!harnessDefaults) return;
    const newDefaults = {
      ...harnessDefaults,
      [harnessId]: { ...harnessDefaults[harnessId], attentionEnabled },
    };
    setHarnessDefaultsState(newDefaults);
    try {
      await window.electronAPI.setHarnessDefaults(newDefaults);
    } catch (err) {
      console.error('Failed to save agent attention setting:', err);
    }
  };

  const handleSetHarnessAgentBridge = async (harnessId: string, agentBridgeEnabled: boolean) => {
    if (!harnessDefaults) return;
    const newDefaults = {
      ...harnessDefaults,
      [harnessId]: { ...harnessDefaults[harnessId], agentBridgeEnabled },
    };
    setHarnessDefaultsState(newDefaults);
    try {
      await window.electronAPI.setHarnessDefaults(newDefaults);
    } catch (err) {
      console.error('Failed to save Clanker bridge setting:', err);
    }
  };

  const handleSetHarnessUsageVisible = async (harnessId: string, usageVisible: boolean) => {
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
      console.error('Failed to save usage visibility:', err);
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

  const loadHarnessModels = async (harnessId: string, refresh = false) => {
    if (environmentId !== 'local') {
      setHarnessModelCache((prev) => ({ ...prev, [harnessId]: [] }));
      return;
    }
    if (!refresh && harnessModelCache[harnessId] !== undefined) return;
    setHarnessModelLoading((prev) => ({ ...prev, [harnessId]: true }));
    try {
      const models = refresh && harnessId === 'hermes'
        ? await window.electronAPI.getHarnessModels(harnessId, true)
        : await window.electronAPI.getHarnessModels(harnessId);
      setHarnessModelCache((prev) => ({ ...prev, [harnessId]: models }));
    } catch (err) {
      console.error(`Failed to load models for ${harnessId}:`, err);
      if (!refresh) setHarnessModelCache((prev) => ({ ...prev, [harnessId]: [] }));
    } finally {
      setHarnessModelLoading((prev) => ({ ...prev, [harnessId]: false }));
    }
  };

  const aiCommitProviderOptions = useMemo(
    () => HARNESS_OPTIONS
      .filter((option) => option.id !== '' && AI_COMMIT_PROVIDER_IDS.includes(option.id as (typeof AI_COMMIT_PROVIDER_IDS)[number]))
      .filter((option) => availableHarnessIds.includes(option.id)),
    [availableHarnessIds],
  );

  return {
    harnessDefaultsStatus,
    harnessDiscoveryStatus,
    availableHarnessIds,
    visibleHarnessIds,
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
