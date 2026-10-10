import { useId } from 'react';
import { PanelLeft, PanelTop } from 'lucide-react';
import {
  WORKSPACE_NAVIGATION_MODES,
  WORKSPACE_NAVIGATION_MODE_LABELS,
  isWorkspaceNavigationMode,
} from '../../../shared/types/workspaceNavigation';
import { useWorkspaceNavigationStore } from '../../store/workspaceNavigationStore';
import { SegmentedControl, SegmentedControlItem } from '../ui/SegmentedControl';

const NAVIGATION_MODE_ICONS = { tabs: PanelTop, sidebar: PanelLeft } as const;

export default function WorkspaceLayoutSettings() {
  const navigationLabelId = useId();
  const navigationMode = useWorkspaceNavigationStore((state) => state.mode);
  const setNavigationMode = useWorkspaceNavigationStore((state) => state.setMode);

  return (
    <section className="settings-section" aria-label="Workspace navigation">
      <div className="settings-row">
        <span className="settings-row-label" id={navigationLabelId}>Workspaces</span>
        <SegmentedControl
          className="settings-segmented"
          aria-labelledby={navigationLabelId}
          value={navigationMode}
          onValueChange={(selected) => {
            if (isWorkspaceNavigationMode(selected)) void setNavigationMode(selected);
          }}
        >
          {WORKSPACE_NAVIGATION_MODES.map((mode) => {
            const Icon = NAVIGATION_MODE_ICONS[mode];
            return (
              <SegmentedControlItem key={mode} value={mode}>
                <Icon size={12} strokeWidth={2} aria-hidden="true" />
                {WORKSPACE_NAVIGATION_MODE_LABELS[mode]}
              </SegmentedControlItem>
            );
          })}
        </SegmentedControl>
      </div>
    </section>
  );
}
