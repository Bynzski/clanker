import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { selectFocusedWorkspace, useWorkspaceStore } from '../../store/workspaceStore';
import { registerOpenSettingsHandler } from '../../lib/keybindingDispatcher';
import { registerManageAccountsHandler, registerSshSettingsHandler, type SshSettingsHandoff } from '../../lib/settingsHandoff';
import { useHeaderSettings } from '../useHeaderSettings';
import { Dialog } from '../ui/Dialog';
import SettingsManagement, { type SettingsPage } from './SettingsManagement';
import AuthenticationSettings, { type AuthenticationSection } from './AuthenticationSettings';
import SshTargetsSettings from './SshTargetsSettings';
import SettingsSearch from './SettingsSearch';
import { IconButton } from '../ui/IconButton';
import { ArrowLeft } from 'lucide-react';
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
  const [authentication, setAuthentication] = useState<AuthenticationSection>('ssh');
  const [sshRequest, setSshRequest] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ id: string; serial: number } | null>(null);
  const serial = useRef(0);
  const sshHandoff = useRef<(SshSettingsHandoff & { selectedId?: string }) | null>(null);
  const sshSelection = useRef<string | null | undefined>(undefined);
  const returning = useRef(false);
  const handingBack = useRef(false);
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
  const requestClose = () => {
    if (busy || returning.current) return;
    const handoff = sshHandoff.current;
    if (handoff) {
      returning.current = true;
      const accepted = handoff.onReturn(handoff.selectedId, (acquired = true) => {
        handingBack.current = acquired; returning.current = false; sshHandoff.current = null; setShowSettings(false);
      });
      if (accepted) return;
      returning.current = false; sshHandoff.current = null;
    }
    setFocusTarget(null); setShowSettings(false);
  };
  const openSettings = () => {
    if (!showSettings) { sshSelection.current = undefined; setPage('appearance'); setSshRequest(null); setFocusTarget(null); }
    setShowSettings(true);
  };
  useEffect(() => registerOpenSettingsHandler(openSettings));
  useEffect(() => registerManageAccountsHandler((harness, intent) => {
    setFocusTarget(null); setPage('accounts');
    setAccountHarness(harness);
    setAccountIntent({ harness, intent });
    setShowSettings(true);
  }));

  useEffect(() => registerSshSettingsHandler((request) => {
    if (busy || returning.current || sshHandoff.current) return false;
    sshHandoff.current = request; sshSelection.current = request.environmentId;
    setFocusTarget(null); setPage('ssh-targets'); setSshRequest(++serial.current);
    if (showSettings) request.onAcquired(); // Already owns the incoming lease.
    setShowSettings(true);
    return true;
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
    openSettings, closeSettings: requestClose, settingsTriggerRef }}>
    {children}
    <Dialog open={showSettings} onOpenChange={(open) => { if (!open) requestClose(); }}>
      <SettingsManagement page={page} onPageChange={(next) => { if (!busy) { setFocusTarget(null); setAccountIntent(null); setPage(next); } }} environmentId={environmentId}
        assistantsAvailable={assistantsAvailable} busy={busy} focusTarget={focusTarget}
        headerActions={<>{sshHandoff.current && <IconButton variant="ghost" disabled={busy} aria-label="Back to Open Workspace" title="Back to Open Workspace" onClick={requestClose}><ArrowLeft size={14} /></IconButton>}
          <SettingsSearch assistantsAvailable={assistantsAvailable} disabled={busy} onSelect={(result) => {
            if (busy) return;
            setAccountIntent(null);
            if (result.harness) { settings.setExpandedHarness(result.harness); setAccountHarness(result.harness); }
            if (result.authentication) setAuthentication(result.authentication);
            setPage(result.page); setFocusTarget({ id: result.target, serial: ++serial.current });
          }} /></>}
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
        onOpenAutoFocus={() => sshHandoff.current?.onAcquired()}
        onCloseAutoFocus={(event) => {
          if (handingBack.current) { event.preventDefault(); handingBack.current = false; }
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
        {page === 'authentication' && showSettings && <AuthenticationSettings section={authentication} loadStatus={!focusTarget} onSectionChange={(section) => { setFocusTarget(null); setAuthentication(section); }} />}
        {page === 'ssh-targets' && <SshTargetsSettings key={sshRequest ?? 'page'} initialTargetId={sshSelection.current} focusOnLoad={!focusTarget}
          onSelectionChange={(id) => { sshSelection.current = id; }} onBusyChange={setBusy} onSaved={(config) => { if (sshHandoff.current) sshHandoff.current.selectedId = config.id; }}
          onDeleted={(id) => { if (sshHandoff.current && (sshHandoff.current.selectedId ?? sshHandoff.current.environmentId) === id) sshHandoff.current.selectedId = 'local'; }} />}
      </SettingsManagement>
    </Dialog>
  </SettingsContext.Provider>;
}
