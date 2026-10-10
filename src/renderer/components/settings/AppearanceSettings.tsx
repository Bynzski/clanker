import { useId } from 'react';
import { useThemeStore } from '../../theme/themeStore';
import ThemePicker from './ThemePicker';

export default function AppearanceSettings() {
  const themeLabelId = useId();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  return (
    <section className="settings-section" aria-label="Theme selection">
      <div className="settings-field">
        <span className="settings-row-label" id={themeLabelId}>Theme</span>
        <ThemePicker aria-labelledby={themeLabelId} value={theme} onChange={(selected) => void setTheme(selected)} />
      </div>
    </section>
  );
}
