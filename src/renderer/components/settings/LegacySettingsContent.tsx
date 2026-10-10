import { ChevronRight, KeyRound } from 'lucide-react';
import { Button } from '../ui/Button';

/** Only Phase 2B entry points remain; migrated settings have no competing implementation. */
export default function LegacySettingsContent({ onOpenCredentials }: { onOpenCredentials: () => void }) {
  return <div className="settings-section settings-links">
    <Button size="xs" variant="ghost" className="settings-dropdown-action" onClick={onOpenCredentials}>
      <KeyRound size={13} strokeWidth={2} aria-hidden="true" />
      <span>Manage VCS credentials</span>
      <ChevronRight className="settings-dropdown-action-chevron" size={13} strokeWidth={2} aria-hidden="true" />
    </Button>
  </div>;
}
