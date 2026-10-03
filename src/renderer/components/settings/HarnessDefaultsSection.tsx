import { Button } from '../ui/Button';
import { ModelSearchPicker } from '../ModelSearchPicker';
import { Input } from '../ui/Input';
import { useState } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { HARNESS_OPTIONS } from '../../lib/harnessOptions';
import { hermesModelLabel } from '../../lib/hermesModelDisplay';
import { HARNESS_FLAGS_PLACEHOLDER } from '../../lib/harnessFlags';
import { KNOWN_HARNESS_IDS } from '../../../shared/harnessIds';
import { HARNESS_DESCRIPTORS } from '../../../shared/harnessDescriptors';
import HarnessAccountsRow from './HarnessAccountsRow';
import type { HarnessDefaultsMap } from '../../../shared/types/store';
import type { ModelOption } from '../../types/shared';

interface HarnessDefaultsSectionProps {
  harnessDefaults: HarnessDefaultsMap;
  availableHarnessIds: string[];
  expandedHarness: string | null;
  setExpandedHarness: (id: string | null) => void;
  harnessModelCache: Record<string, ModelOption[]>;
  harnessModelLoading: Record<string, boolean>;
  loadHarnessModels: (harnessId: string, refresh?: boolean) => Promise<void>;
  handleSetHarnessFlags: (harnessId: string, flags: string) => Promise<void>;
  handleSetHarnessVisible: (harnessId: string, visible: boolean) => Promise<void>;
  handleSetHarnessAttention: (harnessId: string, enabled: boolean) => Promise<void>;
  handleSetHarnessUsageVisible: (harnessId: string, visible: boolean) => Promise<void>;
  handleSetDefaultModel: (harnessId: string, modelId: string) => Promise<void>;
  handleToggleFavorite: (harnessId: string, modelId: string) => Promise<void>;
  /** Environment whose accounts are managed here; defaults to the local machine. */
  accountEnvironmentId?: string;
  /** Renderer-only handoff from Usage, delivered only to the matching harness's account row. */
  accountIntent?: { harness: string; intent: 'manage' | 'add' } | null;
  onAccountIntentConsumed?: () => void;
}

// Same order as the toolbar launchers and the workspace launcher.
const presentationIndex = (id: string) => {
  const index = HARNESS_OPTIONS.findIndex((option) => option.id === id);
  return index === -1 ? HARNESS_OPTIONS.length : index;
};
const HARNESS_DEFAULTS_ORDER = [...KNOWN_HARNESS_IDS].sort((a, b) => presentationIndex(a) - presentationIndex(b));

export default function HarnessDefaultsSection({
  harnessDefaults,
  availableHarnessIds,
  expandedHarness,
  setExpandedHarness,
  harnessModelCache,
  harnessModelLoading,
  loadHarnessModels,
  handleSetHarnessFlags,
  handleSetHarnessVisible,
  handleSetHarnessAttention,
  handleSetHarnessUsageVisible,
  handleSetDefaultModel,
  handleToggleFavorite,
  accountEnvironmentId,
  accountIntent,
  onAccountIntentConsumed,
}: HarnessDefaultsSectionProps) {
  const [modelPickerOpen, setModelPickerOpen] = useState<string | null>(null);
  const [isHermesManual, setIsHermesManual] = useState(false);
  return (
    <div className="settings-section">
      <div className="settings-section-title">Harness Defaults</div>
      {HARNESS_DEFAULTS_ORDER.filter((id) => availableHarnessIds.includes(id)).map((harnessId) => {
        const option = HARNESS_OPTIONS.find((entry) => entry.id === harnessId);
        const defaults = harnessDefaults[harnessId];
        const isExpanded = expandedHarness === harnessId;
        const models = harnessModelCache[harnessId] ?? [];
        const isModelsLoading = harnessModelLoading[harnessId] ?? false;
        const currentModelId = defaults?.model ?? '';
        const isVisible = defaults?.visible !== false;
        const selectedModel = models.find((modelEntry) => modelEntry.id === currentModelId);
        const modelLabel = selectedModel
          ? (harnessId === 'hermes' ? hermesModelLabel(selectedModel) : selectedModel.label)
          : currentModelId;
        const currentModelMissing = harnessId !== 'hermes' && currentModelId !== '' && !models.some((entry) => entry.id === currentModelId);

        return (
          <div key={harnessId} className="harness-defaults-row">
            <div className="harness-defaults-header-row">
              <label
                className="harness-defaults-visible-toggle"
                title={isVisible ? 'Hide from top bar and launcher' : 'Show in top bar and launcher'}
              >
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={(event) => void handleSetHarnessVisible(harnessId, event.target.checked)}
                  aria-label={`${isVisible ? 'Hide' : 'Show'} ${option?.label ?? harnessId}`}
                />
              </label>
              <button
                type="button"
                className={`harness-defaults-header ${isExpanded ? 'expanded' : ''}`}
                onClick={() => {
                  setModelPickerOpen(null);
                  if (!isExpanded) {
                    setExpandedHarness(harnessId);
                    void loadHarnessModels(harnessId);
                  } else {
                    setExpandedHarness(null);
                  }
                }}
              >
                {option && (() => {
                  const HarnessIcon = option.Icon;
                  return <HarnessIcon size={13} strokeWidth={2.5} />;
                })()}
                <span className="harness-defaults-label">{option?.label ?? harnessId}</span>
                {currentModelId && (
                  <span
                    className={`harness-defaults-current ${currentModelMissing ? 'unresolved' : ''}`}
                    title={currentModelMissing ? 'This model is no longer available' : modelLabel}
                  >
                    {currentModelMissing && (
                      <AlertTriangle size={11} strokeWidth={2} className="unresolved-icon" />
                    )}
                    {modelLabel || currentModelId}
                  </span>
                )}
                <ChevronRight size={12} strokeWidth={2} className="harness-defaults-chevron" />
              </button>
            </div>

            {isExpanded && (
              <div className="harness-defaults-panel">
                <label className="harness-defaults-attention-toggle">
                  <span className="harness-defaults-field-label">Agent attention</span>
                  <input
                    type="checkbox"
                    checked={defaults?.attentionEnabled === true}
                    title={
                      harnessId === 'hermes'
                        ? 'Hermes attention is supported for SSH launches; local Hermes attention remains unavailable'
                        : undefined
                    }
                    onChange={(event) => void handleSetHarnessAttention(harnessId, event.target.checked)}
                    aria-label={`Agent attention for ${option?.label ?? harnessId}`}
                  />
                </label>
                {'usage' in HARNESS_DESCRIPTORS[harnessId as keyof typeof HARNESS_DESCRIPTORS] && (
                  <label className="harness-defaults-attention-toggle">
                    <span className="harness-defaults-field-label">Show in Usage</span>
                    <input
                      type="checkbox"
                      checked={defaults?.usageVisible !== false}
                      onChange={(event) => void handleSetHarnessUsageVisible(harnessId, event.target.checked)}
                      aria-label={`Show ${option?.label ?? harnessId} in Usage`}
                    />
                  </label>
                )}
                {'accounts' in HARNESS_DESCRIPTORS[harnessId as keyof typeof HARNESS_DESCRIPTORS] && (
                  <HarnessAccountsRow harnessId={harnessId} harnessLabel={option?.label ?? harnessId} environmentId={accountEnvironmentId}
                    intent={accountIntent?.harness === harnessId ? accountIntent.intent : undefined} onIntentConsumed={onAccountIntentConsumed} />
                )}
                <div className="harness-defaults-field">
                  <span className="harness-defaults-field-label">Extra flags</span>
                  <Input
                    type="text"
                    className="settings-select"
                    value={defaults?.flags ?? ''}
                    onChange={(e) => void handleSetHarnessFlags(harnessId, e.target.value)}
                    placeholder={HARNESS_FLAGS_PLACEHOLDER[harnessId] ?? ''}
                  />
                </div>

                <div className="harness-defaults-field">
                  <span className="harness-defaults-field-label">Default model</span>
                  {harnessId === 'claude' || (harnessId === 'hermes' && models.length === 0) ? (
                    <Input
                      type="text"
                      className="settings-select"
                      aria-label={`${option?.label ?? harnessId} default model`}
                      value={currentModelId}
                      onChange={(e) => void handleSetDefaultModel(harnessId, e.target.value)}
                      placeholder="Use harness default"
                    />
                  ) : (
                    <>
                      {harnessId === 'hermes' && isHermesManual ? (
                        <Input
                          type="text"
                          className="settings-select"
                          aria-label="Hermes custom model"
                          autoFocus
                          value={models.some((entry) => entry.id === currentModelId) ? '' : currentModelId}
                          onChange={(e) => void handleSetDefaultModel(harnessId, e.target.value)}
                          placeholder="Enter custom model"
                        />
                      ) : (
                        <ModelSearchPicker harness={harnessId} model={currentModelId} models={models}
                          favorites={defaults?.favorites ?? []} savedHermesModel={currentModelId}
                          refreshing={isModelsLoading} loading={isModelsLoading} disabled={isModelsLoading}
                          fullWidth includeDefault triggerLabel={`${option?.label ?? harnessId} default model`}
                          open={modelPickerOpen === harnessId}
                          onOpenChange={(open) => setModelPickerOpen(open ? harnessId : null)}
                          onSelect={(model) => void handleSetDefaultModel(harnessId, model)}
                          onToggleFavorite={(model) => handleToggleFavorite(harnessId, model)}
                          onRefreshHermes={() => { setModelPickerOpen(null); void loadHarnessModels('hermes', true); }}
                          onEnterCustom={harnessId === 'hermes' ? () => setIsHermesManual(true) : undefined}
                          isUnresolved={(model) => harnessId !== 'hermes' && !!model && !models.some((entry) => entry.id === model)}
                        />
                      )}
                      {harnessId === 'hermes' && isHermesManual && (
                        <Button type="button" onClick={() => setIsHermesManual(false)}>
                          Browse Hermes models
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {harnessId === 'hermes' && (isHermesManual || models.length === 0) && (
                  <Button
                    type="button"
                    onClick={() => void loadHarnessModels('hermes', true)}
                    disabled={isModelsLoading}
                  >
                    {isModelsLoading ? 'Refreshing Hermes models…' : 'Refresh Hermes models'}
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
