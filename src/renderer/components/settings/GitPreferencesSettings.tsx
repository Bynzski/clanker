import { Select } from '../ui/Select';
import { Checkbox } from '../ui/Checkbox';
import { Field, FieldLabel } from '../ui/Field';
import type { useHeaderSettings } from '../useHeaderSettings';

export default function GitPreferencesSettings({ settings }: { settings: ReturnType<typeof useHeaderSettings> }) {
  const { aiCommitEnabled, aiCommitProvider, aiCommitProviderOptions, aiCommitModel, aiCommitModels,
    isLoadingAiCommitModels, handleToggleAiCommit, handleAiCommitProviderChange, handleAiCommitModelChange } = settings;
  return <div className="settings-git-preferences">
    <Checkbox checked={aiCommitEnabled} onChange={(event) => void handleToggleAiCommit(event.target.checked)}>AI commit messages</Checkbox>
    <Field>
      <FieldLabel htmlFor="ai-commit-provider">Provider</FieldLabel>
      <Select id="ai-commit-provider" aria-label="AI commit provider" value={aiCommitProvider}
        onChange={(event) => void handleAiCommitProviderChange(event.target.value)} disabled={!aiCommitEnabled || aiCommitProviderOptions.length === 0}>
        {aiCommitProviderOptions.length === 0 ? <option value="">No providers available</option> :
          aiCommitProviderOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </Select>
    </Field>
    <Field>
      <FieldLabel htmlFor="ai-commit-model">Model</FieldLabel>
      <Select id="ai-commit-model" aria-label="AI commit model" value={aiCommitModel}
        onChange={(event) => void handleAiCommitModelChange(event.target.value)} disabled={!aiCommitEnabled || isLoadingAiCommitModels}>
        {isLoadingAiCommitModels ? <option value="">Loading models…</option> : <>
          <option value="">Harness default</option>
          {aiCommitModel && !aiCommitModels.some((model) => model.id === aiCommitModel) && <option value={aiCommitModel}>{aiCommitModel} (not in catalog)</option>}
          {aiCommitModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </>}
      </Select>
    </Field>
    {settings.aiCommitDiscoveryError && <p role="alert">{settings.aiCommitDiscoveryError}</p>}
    {settings.aiCommitModelsError && <p role="alert">{settings.aiCommitModelsError}</p>}
  </div>;
}
