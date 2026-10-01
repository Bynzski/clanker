import { Select } from '../ui/Select';
import { useId } from 'react';
import { THEME_IDS, THEME_METADATA, isThemeId } from '../../../shared/types/theme';
import { useThemeStore } from '../../theme/themeStore';

export default function AppearanceSettings() {
  const selectId = useId();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

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
    </section>
  );
}
