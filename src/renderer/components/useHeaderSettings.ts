import { useEffect, useMemo, useState } from 'react';
import {
  AI_COMMIT_PROVIDER_IDS,
  HARNESS_OPTIONS,
  resolveAvailableHarnessIds,
  resolveVisibleHarnessIds,
} from '../lib/harnessOptions';
import type { HarnessDefaultsMap } from '../../shared/types/store';
import type { ModelOption } from '../types/shared';

interface UseHeaderSettingsOptions {
  harness: string;
  setHarness: (harnessId: string) => void;
}

export function useHeaderSettings({ harness, setHarness }: UseHeaderSettingsOptions) {
  const [availableHarnessIds, setAvailableHarnessIds] = useState<string[]>(['']);
  const [showSettings, setShowSettings] = useState(false);
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [aiCommitEnabled, setAiCommitEnabled] = useState(false);
  const [aiCommitProvider, setAiCommitProvider] = useState<string>('');
  const [aiCommitModel, setAiCommitModel] = useState('');
  const [aiCommitModels, setAiCommitModels] = useState<ModelOption[]>([]);
  const [isLoadingAiCommitModels, setIsLoadingAiCommitModels] = useState(false);
  const [hasLoadedAiCommitSettings, setHasLoadedAiCommitSettings] = useState(false);
  const [harnessDefaults, setHarnessDefaultsState] = useState<HarnessDefaultsMap | null>(null);
  const [expandedHarness, setExpandedHarness] = useState<string | null>(null);
  const [harnessModelCache, setHarnessModelCache] = useState<Record<string, ModelOption[]>>({});
  const [harnessModelLoading, setHarnessModelLoading] = useState<Record<string, boolean>>({});
  const visibleHarnessIds = useMemo(
    () => resolveVisibleHarnessIds(availableHarnessIds, harnessDefaults),
    [availableHarnessIds, harnessDefaults],
  );

  useEffect(() => {
    let cancelled = false;

    const loadHarnessOptions = async () => {
      try {
        const options = await window.electronAPI.getHarnessOptions();
        if (cancelled) return;
        setAvailableHarnessIds(resolveAvailableHarnessIds(options));
      } catch {
        if (!cancelled) {
          setAvailableHarnessIds(['']);
        }
      }
    };

    void loadHarnessOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (harness && !visibleHarnessIds.includes(harness)) {
      setHarness('');
    }
  }, [harness, setHarness, visibleHarnessIds]);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    const loadHarnessDefaults = async () => {
      try {
        const defaults = await window.electronAPI.getHarnessDefaults();
        setHarnessDefaultsState(defaults);
      } catch (err) {
        console.error('Failed to load harness defaults:', err);
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

  const aiCommitProviderOptions = useMemo(
    () => HARNESS_OPTIONS
      .filter((option) => option.id !== '' && AI_COMMIT_PROVIDER_IDS.includes(option.id as (typeof AI_COMMIT_PROVIDER_IDS)[number]))
      .filter((option) => availableHarnessIds.includes(option.id)),
    [availableHarnessIds],
  );

  return {
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
    handleSetDefaultModel,
    handleToggleFavorite,
    loadHarnessModels,
    aiCommitProviderOptions,
  };
}
