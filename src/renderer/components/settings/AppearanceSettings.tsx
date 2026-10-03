import { useId } from 'react';
import { PanelLeft, PanelTop } from 'lucide-react';
import { useThemeStore } from '../../theme/themeStore';
import {
  WORKSPACE_NAVIGATION_MODES,
  WORKSPACE_NAVIGATION_MODE_LABELS,
  isWorkspaceNavigationMode,
} from '../../../shared/types/workspaceNavigation';
import { useWorkspaceNavigationStore } from '../../store/workspaceNavigationStore';
import { SegmentedControl, SegmentedControlItem } from '../ui/SegmentedControl';
import ThemePicker from './ThemePicker';

const NAVIGATION_MODE_ICONS = { tabs: PanelTop, sidebar: PanelLeft } as const;

export default function AppearanceSettings() {
  const themeLabelId = useId();
  const navigationLabelId = useId();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const navigationMode = useWorkspaceNavigationStore((state) => state.mode);
  const setNavigationMode = useWorkspaceNavigationStore((state) => state.setMode);

  return (
    <section className="settings-section" aria-label="Appearance">
      <div className="settings-section-title">Appearance</div>
      <div className="settings-field">
        <span className="settings-row-label" id={themeLabelId}>Theme</span>
        <ThemePicker aria-labelledby={themeLabelId} value={theme} onChange={(selected) => void setTheme(selected)} />
      </div>
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
