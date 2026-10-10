import { ChevronRight, KeyRound } from 'lucide-react';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import AssistantsSettings from './AssistantsSettings';
import HarnessDefaultsSection from './HarnessDefaultsSection';
import type { useHeaderSettings } from '../useHeaderSettings';

export default function LegacySettingsContent({ settings, environmentId, accountIntent, onAccountIntentConsumed, onOpenCredentials }: {
  settings: ReturnType<typeof useHeaderSettings>;
  environmentId: string;
  accountIntent: { harness: string; intent: 'manage' | 'add' } | null;
  onAccountIntentConsumed: () => void;
  onOpenCredentials: () => void;
}) {
  const { aiCommitEnabled, aiCommitProvider, aiCommitProviderOptions, aiCommitModel, aiCommitModels,
    isLoadingAiCommitModels, handleToggleAiCommit, handleAiCommitProviderChange, handleAiCommitModelChange,
    harnessDefaults, availableHarnessIds, expandedHarness, setExpandedHarness, harnessModelCache,
    harnessModelLoading, loadHarnessModels, handleSetHarnessFlags, handleSetHarnessVisible,
    handleSetHarnessAttention, handleSetHarnessUsageVisible, handleSetHarnessAgentBridge,
    handleSetDefaultModel, handleToggleFavorite } = settings;
  return <>
    <AssistantsSettings />
    <div className="settings-section">
      <div className="settings-section-title">Git</div>
      <label className="settings-option">
        <input type="checkbox" checked={aiCommitEnabled} onChange={(event) => void handleToggleAiCommit(event.target.checked)} />
        <span>AI commit messages</span>
      </label>
      <div className="settings-row">
        <span className="settings-row-label">Provider</span>
        <Select className="settings-select" aria-label="AI commit provider" value={aiCommitProvider}
          onChange={(event) => void handleAiCommitProviderChange(event.target.value)}
          disabled={!aiCommitEnabled || aiCommitProviderOptions.length === 0}>
          {aiCommitProviderOptions.length === 0 ? <option value="">No providers available</option> :
            aiCommitProviderOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </Select>
      </div>
      <div className="settings-row">
        <span className="settings-row-label">Model</span>
        <Select className="settings-select" aria-label="AI commit model" value={aiCommitModel}
          onChange={(event) => void handleAiCommitModelChange(event.target.value)} disabled={!aiCommitEnabled || isLoadingAiCommitModels}>
          {isLoadingAiCommitModels ? <option value="">Loading models…</option> : <>
            <option value="">Harness default</option>
            {aiCommitModel && !aiCommitModels.some((model) => model.id === aiCommitModel) &&
              <option value={aiCommitModel}>{aiCommitModel} (not in catalog)</option>}
            {aiCommitModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
          </>}
        </Select>
      </div>
    </div>
    <div className="settings-section settings-links">
      <Button size="xs" variant="ghost" className="settings-dropdown-action" onClick={onOpenCredentials}>
        <KeyRound size={13} strokeWidth={2} aria-hidden="true" />
        <span>Manage VCS credentials</span>
        <ChevronRight className="settings-dropdown-action-chevron" size={13} strokeWidth={2} aria-hidden="true" />
      </Button>
    </div>
    {harnessDefaults && <HarnessDefaultsSection harnessDefaults={harnessDefaults} availableHarnessIds={availableHarnessIds}
      expandedHarness={expandedHarness} setExpandedHarness={setExpandedHarness} harnessModelCache={harnessModelCache}
      harnessModelLoading={harnessModelLoading} loadHarnessModels={loadHarnessModels} handleSetHarnessFlags={handleSetHarnessFlags}
      handleSetHarnessVisible={handleSetHarnessVisible} handleSetHarnessAttention={handleSetHarnessAttention}
      handleSetHarnessUsageVisible={handleSetHarnessUsageVisible} handleSetHarnessAgentBridge={handleSetHarnessAgentBridge}
      handleSetDefaultModel={handleSetDefaultModel} handleToggleFavorite={handleToggleFavorite}
      accountEnvironmentId={environmentId} accountIntent={accountIntent} onAccountIntentConsumed={onAccountIntentConsumed} />}
  </>;
}
