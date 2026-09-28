import { ArrowLeft, Settings } from 'lucide-react';
import HarnessDefaultsSection from './settings/HarnessDefaultsSection';
import { useHeaderSettings } from './useHeaderSettings';
import type { HarnessDefaultsMap } from '../../shared/types/store';

interface Props {
  selectedHarness: string;
  onSelectHarness: (harnessId: string) => void;
  onBack: (defaults: HarnessDefaultsMap | null) => void;
}

export default function GateHarnessSettings({ selectedHarness, onSelectHarness, onBack }: Props) {
  const settings = useHeaderSettings({
    harness: selectedHarness,
    setHarness: onSelectHarness,
    includeAiCommit: false,
    validateHarness: false,
  });

  return (
    <div className="gate-view gate-view-settings">
      <button className="gate-worktree-back" type="button" onClick={() => onBack(settings.harnessDefaults)}>
        <ArrowLeft size={14} strokeWidth={2} /> Back to workspace
      </button>
      <div className="gate-worktree-heading">
        <Settings size={18} strokeWidth={2} />
        <div>
          <h2>Harness settings</h2>
          <p>Set visibility, models, flags, and favorites for future launches.</p>
        </div>
      </div>
      {settings.harnessDefaults ? (
        <HarnessDefaultsSection
          harnessDefaults={settings.harnessDefaults}
          availableHarnessIds={settings.availableHarnessIds}
          expandedHarness={settings.expandedHarness}
          setExpandedHarness={settings.setExpandedHarness}
          harnessModelCache={settings.harnessModelCache}
          harnessModelLoading={settings.harnessModelLoading}
          loadHarnessModels={settings.loadHarnessModels}
          handleSetHarnessFlags={settings.handleSetHarnessFlags}
          handleSetHarnessVisible={settings.handleSetHarnessVisible}
          handleSetHarnessAttention={settings.handleSetHarnessAttention}
          handleSetDefaultModel={settings.handleSetDefaultModel}
          handleToggleFavorite={settings.handleToggleFavorite}
        />
      ) : (
        <p className="gate-settings-loading">Loading harness settings…</p>
      )}
    </div>
  );
}
