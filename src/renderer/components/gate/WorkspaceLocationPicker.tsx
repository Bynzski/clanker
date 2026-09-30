import { SegmentedControl, SegmentedControlItem } from '../ui/SegmentedControl';

type WorkspaceLocation = 'local' | 'ssh';
interface WorkspaceLocationPickerProps {
  location: WorkspaceLocation;
  onChange: (location: WorkspaceLocation) => void;
}

export function WorkspaceLocationPicker({ location, onChange }: WorkspaceLocationPickerProps) {
  return (
    <SegmentedControl aria-label="Workspace location" className="gate-location-selector" value={location}
      onValueChange={(value) => onChange(value === 'ssh' ? 'ssh' : 'local')}>
      <SegmentedControlItem value="local" className="gate-location-btn"
        onClick={() => { if (location === 'local') onChange('local'); }}>Local</SegmentedControlItem>
      <SegmentedControlItem value="ssh" className="gate-location-btn"
        onClick={() => { if (location === 'ssh') onChange('ssh'); }}>SSH Remote</SegmentedControlItem>
    </SegmentedControl>
  );
}
