import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { selectFocusedWorkspace, useWorkspaceStore } from '../../store/workspaceStore';
import { registerOpenSettingsHandler } from '../../lib/keybindingDispatcher';
import { registerManageAccountsHandler } from '../../lib/settingsHandoff';
import { useHeaderSettings } from '../useHeaderSettings';
import { Dialog } from '../ui/Dialog';
import SettingsManagement, { type SettingsPage } from './SettingsManagement';
import CredentialSettings from './CredentialSettings';
import LegacySettingsContent from './LegacySettingsContent';
import HarnessDefaultsSection from './HarnessDefaultsSection';
import AccountsSettings from './AccountsSettings';
import GitPreferencesSettings from './GitPreferencesSettings';
import { useAssistantsStore } from '../../store/assistantsStore';

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
  const [accountHarness, setAccountHarness] = useState<string | null>(null);
  const assistantsAvailable = useAssistantsStore((state) => state.snapshot?.available === true);
  const ensureAssistants = useAssistantsStore((state) => state.ensureSubscribed);
  useEffect(() => { ensureAssistants(); }, [ensureAssistants]);
  if (page === 'assistants' && !assistantsAvailable) setPage('appearance');
  const [accountIntent, setAccountIntent] = useState<{ harness: string; intent: 'manage' | 'add' } | null>(null);
  const [intentOwner, setIntentOwner] = useState({ workspaceId: workspace?.id, environmentId });
  if (intentOwner.workspaceId !== workspace?.id || intentOwner.environmentId !== environmentId) {
    setIntentOwner({ workspaceId: workspace?.id, environmentId });
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
    setPage('accounts');
    setAccountHarness(harness);
    setAccountIntent({ harness, intent });
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
      <SettingsManagement page={page} onPageChange={(next) => { setAccountIntent(null); setPage(next); }} environmentId={environmentId}
        assistantsAvailable={assistantsAvailable}
        onCloseAutoFocus={(event) => {
          if (credentialHandoff.current) event.preventDefault();
          else restoreToolbarFocus(event);
        }}>
        {page === 'harnesses' && <>
          {settings.harnessDiscoveryStatus !== 'ready' && <p role="status">{settings.harnessDiscoveryStatus === 'failed' ? 'Harness discovery failed.' : 'Discovering harnesses…'}</p>}
          {settings.harnessDefaultsStatus !== 'ready' ? <p role="status">{settings.harnessDefaultsStatus === 'failed' ? 'Could not load harness preferences.' : 'Loading preferences…'}</p> : settings.harnessDefaults &&
            <HarnessDefaultsSection {...settings} harnessDefaults={settings.harnessDefaults} environmentId={environmentId}
              onManageAccounts={(harness) => {
                setAccountHarness(harness);
                setAccountIntent({ harness, intent: 'manage' });
                setPage('accounts');
              }} />}
          {settings.settingsError && <p role="alert">{settings.settingsError}</p>}
        </>}
        {page === 'accounts' && <AccountsSettings environmentId={environmentId} harnessId={accountHarness}
          onSelect={(id) => { setAccountIntent(null); setAccountHarness(id); }}
          availableHarnessIds={settings.availableHarnessIds} discoveryStatus={settings.harnessDiscoveryStatus}
          intent={accountIntent?.harness === accountHarness ? accountIntent.intent : undefined}
          onIntentConsumed={() => setAccountIntent(null)} />}
        {page === 'git-preferences' && <><GitPreferencesSettings settings={settings} />{settings.settingsError && <p role="alert">{settings.settingsError}</p>}</>}
        {page === 'legacy' && <LegacySettingsContent onOpenCredentials={() => {
          credentialHandoff.current = true;
          setShowCredentials(true);
        }} />}
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
