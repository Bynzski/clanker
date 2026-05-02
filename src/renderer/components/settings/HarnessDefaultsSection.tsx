import { AlertTriangle, ChevronRight, Star } from 'lucide-react';
import { HARNESS_OPTIONS } from '../../lib/harnessOptions';
import { HARNESS_FLAGS_PLACEHOLDER } from '../../lib/harnessFlags';
import { KNOWN_HARNESS_IDS } from '../../../shared/harnessIds';
import type { HarnessDefaultsMap } from '../../../shared/types/store';
import type { ModelOption } from '../../types/shared';

interface HarnessDefaultsSectionProps {
  harnessDefaults: HarnessDefaultsMap;
  availableHarnessIds: string[];
  expandedHarness: string | null;
  setExpandedHarness: (id: string | null) => void;
  harnessModelCache: Record<string, ModelOption[]>;
  harnessModelLoading: Record<string, boolean>;
  loadHarnessModels: (harnessId: string) => Promise<void>;
  handleSetHarnessFlags: (harnessId: string, flags: string) => Promise<void>;
  handleSetDefaultModel: (harnessId: string, modelId: string) => Promise<void>;
  handleToggleFavorite: (harnessId: string, modelId: string) => Promise<void>;
}

export default function HarnessDefaultsSection({
  harnessDefaults,
  availableHarnessIds,
  expandedHarness,
  setExpandedHarness,
  harnessModelCache,
  harnessModelLoading,
  loadHarnessModels,
  handleSetHarnessFlags,
  handleSetDefaultModel,
  handleToggleFavorite,
}: HarnessDefaultsSectionProps) {
  return (
    <div className="settings-section">
      <div className="settings-section-title">Harness Defaults</div>
      {KNOWN_HARNESS_IDS.filter((id) => availableHarnessIds.includes(id)).map((harnessId) => {
        const option = HARNESS_OPTIONS.find((entry) => entry.id === harnessId);
        const defaults = harnessDefaults[harnessId];
        const isExpanded = expandedHarness === harnessId;
        const models = harnessModelCache[harnessId] ?? [];
        const isModelsLoading = harnessModelLoading[harnessId] ?? false;
        const currentModelId = defaults?.model ?? '';
        const modelLabel = currentModelId
          ? (models.find((modelEntry) => modelEntry.id === currentModelId)?.label ?? currentModelId)
          : '';
        const currentModelMissing = currentModelId !== '' && !models.some((entry) => entry.id === currentModelId);

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

            {isExpanded && (
              <div className="harness-defaults-panel">
                <div className="harness-defaults-field">
                  <span className="harness-defaults-field-label">Extra flags</span>
                  <input
                    type="text"
                    className="settings-select"
                    value={defaults?.flags ?? ''}
                    onChange={(e) => void handleSetHarnessFlags(harnessId, e.target.value)}
                    placeholder={HARNESS_FLAGS_PLACEHOLDER[harnessId] ?? ''}
                  />
                </div>

                <div className="harness-defaults-field">
                  <span className="harness-defaults-field-label">Default model</span>
                  {harnessId === 'claude' ? (
                    <input
                      type="text"
                      className="settings-select"
                      value={currentModelId}
                      onChange={(e) => void handleSetDefaultModel(harnessId, e.target.value)}
                      placeholder="Use harness default"
                    />
                  ) : (
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
                        models.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label}
                          </option>
                        ))
                      )}
                    </select>
                  )}
                </div>

                {((defaults?.favorites?.length ?? 0) > 0 || models.length > 0) && (
                  <div className="harness-defaults-field">
                    <span className="harness-defaults-field-label">Favorites</span>
                    <div className="harness-defaults-favorites">
                      {(defaults?.favorites ?? []).map((favoriteId) => {
                        const favoriteLabel = models.find((entry) => entry.id === favoriteId)?.label ?? favoriteId;
                        const isUnresolved = !models.some((entry) => entry.id === favoriteId);
                        return (
                          <span
                            key={favoriteId}
                            className={`harness-defaults-favorite-tag ${isUnresolved ? 'unresolved' : ''}`}
                            title={
                              isUnresolved
                                ? 'This model is no longer available — click X to remove'
                                : favoriteLabel
                            }
                          >
                            {isUnresolved && (
                              <AlertTriangle size={10} strokeWidth={2} className="unresolved-icon" />
                            )}
                            {favoriteLabel}
                            <button
                              type="button"
                              className="harness-defaults-remove-fav"
                              onClick={() => void handleToggleFavorite(harnessId, favoriteId)}
                              title="Remove from favorites"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                      {models
                        .filter((entry) => !(defaults?.favorites ?? []).includes(entry.id))
                        .slice(0, 5)
                        .map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            className="harness-defaults-add-fav"
                            onClick={() => void handleToggleFavorite(harnessId, entry.id)}
                            title={`Add ${entry.label} to favorites`}
                          >
                            <Star size={10} strokeWidth={2} />
                            {entry.label}
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
  );
}
