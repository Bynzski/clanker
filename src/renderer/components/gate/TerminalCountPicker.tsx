import { SegmentedControl, SegmentedControlItem } from '../ui/SegmentedControl';

export const TERMINAL_PRESETS = [
  { count: 1, label: '1', description: 'Single terminal' },
  { count: 2, label: '2', description: 'Two terminals' },
  { count: 4, label: '4', description: 'Four terminals' },
];

interface TerminalCountPickerProps {
  selectedPreset: number;
  onSelect: (presetIndex: number) => void;
}

export function TerminalCountPicker({ selectedPreset, onSelect }: TerminalCountPickerProps) {
  return (
    <div className="grid-selector">
      <span className="gate-section-label">Terminals</span>
      <SegmentedControl aria-label="Terminals" className="grid-options" value={String(selectedPreset)}
        onValueChange={(value) => onSelect(Number(value))}>
        {TERMINAL_PRESETS.map((preset, index) => (
          <SegmentedControlItem key={preset.count} value={String(index)} className="grid-option"
            title={`Press ${preset.label} to select`}>
            <span className="grid-label">{preset.label} terminal{preset.count > 1 ? 's' : ''}</span>
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  );
}
