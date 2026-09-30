import { Settings } from 'lucide-react';
import type { HarnessOption } from '../../lib/harnessOptions';
import { SegmentedControl, SegmentedControlItem } from '../ui/SegmentedControl';

// UI-only value; Clanker's basic terminal remains the empty-string harness ID.
const BASIC_TERMINAL_VALUE = '__basic_terminal__';
interface HarnessPickerProps {
  options: HarnessOption[];
  selectedHarness: string;
  onSelect: (harness: string) => void;
  onConfigure: () => void;
}

export function HarnessPicker({ options, selectedHarness, onSelect, onConfigure }: HarnessPickerProps) {
  return (
    <div className="harness-selector">
      <div className="gate-section-header">
        <span className="gate-section-label">Harness</span>
        <button type="button" className="gate-settings-link" onClick={onConfigure}>
          <Settings size={12} strokeWidth={2} /> Configure
        </button>
      </div>
      <SegmentedControl aria-label="Harness" className="harness-options" value={selectedHarness || BASIC_TERMINAL_VALUE}
        onValueChange={(value) => onSelect(value === BASIC_TERMINAL_VALUE ? '' : value)}>
        {options.map((harness) => (
          <SegmentedControlItem key={harness.id} value={harness.id || BASIC_TERMINAL_VALUE} className="harness-option"
            // Re-selecting the current harness still closes its model overlays.
            onClick={() => { if (selectedHarness === harness.id) onSelect(harness.id); }}
            title={harness.id ? `Select ${harness.label}` : 'No harness (basic terminal)'}>
            <harness.Icon size={16} strokeWidth={2} className="harness-icon" />
            <span className="harness-label">{harness.label}</span>
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  );
}
