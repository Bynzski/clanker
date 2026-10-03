import { Select } from '../ui/Select';
import { useId } from 'react';
import { THEME_IDS, THEME_METADATA, isThemeId } from '../../../shared/types/theme';
import { useThemeStore } from '../../theme/themeStore';
import {
  WORKSPACE_NAVIGATION_MODES,
  WORKSPACE_NAVIGATION_MODE_LABELS,
  isWorkspaceNavigationMode,
} from '../../../shared/types/workspaceNavigation';
import { useWorkspaceNavigationStore } from '../../store/workspaceNavigationStore';

export default function AppearanceSettings() {
  const selectId = useId();
  const navigationSelectId = useId();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const navigationMode = useWorkspaceNavigationStore((state) => state.mode);
  const setNavigationMode = useWorkspaceNavigationStore((state) => state.setMode);

  return (
    <section className="settings-section" aria-label="Appearance">
      <div className="settings-section-title">Appearance</div>
      <div className="settings-row">
        <label className="settings-row-label" htmlFor={selectId}>Theme</label>
        <Select
          id={selectId}
          className="settings-select"
          value={theme}
          onChange={(event) => {
            const selected = event.target.value;
            if (isThemeId(selected)) void setTheme(selected);
          }}
        >
          {THEME_IDS.map((id) => (
            <option key={id} value={id}>{THEME_METADATA[id].label}</option>
          ))}
        </Select>
      </div>
      <div className="settings-row">
        <label className="settings-row-label" htmlFor={navigationSelectId}>Workspace navigation</label>
        <Select
          id={navigationSelectId}
          className="settings-select"
          value={navigationMode}
          onChange={(event) => {
            const selected = event.target.value;
            if (isWorkspaceNavigationMode(selected)) void setNavigationMode(selected);
          }}
        >
          {WORKSPACE_NAVIGATION_MODES.map((mode) => (
            <option key={mode} value={mode}>{WORKSPACE_NAVIGATION_MODE_LABELS[mode]}</option>
          ))}
        </Select>
      </div>
    </section>
  );
}
