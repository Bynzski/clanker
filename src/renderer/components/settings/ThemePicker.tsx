import * as RadioGroup from '@radix-ui/react-radio-group';
import { Check } from 'lucide-react';
import { THEME_IDS, THEME_METADATA, isThemeId } from '../../../shared/types/theme';
import type { ThemeId } from '../../../shared/types/theme';
import './ThemePicker.css';

interface ThemePickerProps {
  value: ThemeId;
  onChange: (theme: ThemeId) => void;
  'aria-labelledby'?: string;
}

/**
 * Theme choice as miniature app previews. Each preview is painted by its own
 * theme's tokens (`data-theme-preview` in global.css), so swatches always match
 * the real palette without duplicating colours here.
 */
export default function ThemePicker({ value, onChange, 'aria-labelledby': labelledBy }: ThemePickerProps) {
  return (
    <RadioGroup.Root
      className="theme-picker"
      aria-labelledby={labelledBy}
      value={value}
      orientation="horizontal"
      onValueChange={(selected) => { if (isThemeId(selected)) onChange(selected); }}
    >
      {THEME_IDS.map((id) => (
        <RadioGroup.Item key={id} value={id} className="theme-option" aria-label={THEME_METADATA[id].label}>
          <span className="theme-preview" data-theme-preview={id} aria-hidden="true">
            <span className="theme-preview-titlebar">
              <span className="theme-preview-brand" />
            </span>
            <span className="theme-preview-body">
              <span className="theme-preview-sidebar">
                <span className="theme-preview-row active" />
                <span className="theme-preview-row" />
                <span className="theme-preview-row" />
              </span>
              <span className="theme-preview-pane">
                <span className="theme-preview-line primary" />
                <span className="theme-preview-line secondary" />
                <span className="theme-preview-statuses">
                  <span className="success" />
                  <span className="warning" />
                  <span className="error" />
                  <span className="info" />
                </span>
              </span>
            </span>
          </span>
          <span className="theme-option-footer">
            <span className="theme-option-label">{THEME_METADATA[id].label}</span>
            <RadioGroup.Indicator className="theme-option-check">
              <Check size={11} strokeWidth={2.5} aria-hidden="true" />
            </RadioGroup.Indicator>
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
