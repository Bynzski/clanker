import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { selectFocusedWorkspace, useWorkspaceStore } from '../../store/workspaceStore';
import { registerOpenSettingsHandler } from '../../lib/keybindingDispatcher';
import { registerManageAccountsHandler } from '../../lib/settingsHandoff';
import { useHeaderSettings } from '../useHeaderSettings';
import { Dialog } from '../ui/Dialog';
import SettingsManagement, { type SettingsPage } from './SettingsManagement';
import CredentialSettings from './CredentialSettings';
import LegacySettingsContent from './LegacySettingsContent';

interface SettingsEntryPoint {
  visibleHarnessIds: string[];
  showSettings: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  settingsTriggerRef: RefObject<HTMLButtonElement | null>;
}
const SettingsContext = createContext<SettingsEntryPoint | null>(null);

export function useApplicationSettings() {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error('Settings entry points require ApplicationSettingsProvider');
  return settings;
}

/** One app-owned Settings controller and destination, independent of toolbar placement. */
export function ApplicationSettingsProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspaceStore(selectFocusedWorkspace);
  const setHarness = useWorkspaceStore((state) => state.setHarness);
  const environmentId = workspace?.environmentId || 'local';
  const settings = useHeaderSettings({ harness: workspace?.harness ?? '', setHarness, environmentId });
  const [showSettings, setShowSettings] = useState(false);
  const [page, setPage] = useState<SettingsPage>('appearance');
  const [showCredentials, setShowCredentials] = useState(false);
  const [accountIntent, setAccountIntent] = useState<{ harness: string; intent: 'manage' | 'add' } | null>(null);
  const [intentOwner, setIntentOwner] = useState(workspace?.id);
  if (intentOwner !== workspace?.id) {
    setIntentOwner(workspace?.id);
    setAccountIntent(null);
  }
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const credentialHandoff = useRef(false);
  const openSettings = () => {
    if (!showSettings) setPage('appearance');
    setShowSettings(true);
  };
  useEffect(() => registerOpenSettingsHandler(openSettings));
  useEffect(() => registerManageAccountsHandler((harness, intent) => {
    setPage('legacy');
    setAccountIntent({ harness, intent });
    settings.setExpandedHarness(harness);
    void settings.loadHarnessModels(harness);
    setShowSettings(true);
  }));

  // The initiating Header/Usage button may have unmounted. Resolve the live toolbar
  // ref at close time, never retain a disconnected trigger from the old placement.
  const restoreToolbarFocus = (event: Event) => {
    if (settingsTriggerRef.current) {
      event.preventDefault();
      settingsTriggerRef.current.focus();
    }
  };
  return <SettingsContext.Provider value={{ visibleHarnessIds: settings.visibleHarnessIds, showSettings,
    openSettings, closeSettings: () => setShowSettings(false), settingsTriggerRef }}>
    {children}
    <Dialog open={showSettings} onOpenChange={setShowSettings}>
      <SettingsManagement page={page} onPageChange={setPage} environmentId={environmentId}
        onCloseAutoFocus={(event) => {
          if (credentialHandoff.current) event.preventDefault();
          else restoreToolbarFocus(event);
        }}>
        <LegacySettingsContent settings={settings} environmentId={environmentId} accountIntent={accountIntent}
          onAccountIntentConsumed={() => setAccountIntent(null)} onOpenCredentials={() => {
            credentialHandoff.current = true;
            setShowCredentials(true);
          }} />
      </SettingsManagement>
    </Dialog>
    <CredentialSettings isOpen={showCredentials} onClose={() => setShowCredentials(false)}
      workspacePath={workspace?.workspacePath || undefined}
      onOpenAutoFocus={() => {
        // The incoming Dialog already holds its lease before closing Settings.
        setShowSettings(false);
      }}
      onCloseAutoFocus={(event) => {
        restoreToolbarFocus(event);
        credentialHandoff.current = false;
      }} />
  </SettingsContext.Provider>;
}
