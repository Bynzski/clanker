import { useState } from 'react';
import { useAssistantsSnapshot } from '../useAssistantsSnapshot';
import type { AssistantPin, AssistantProfile } from '../../../shared/types/assistants';
import { isValidHarnessProfileName } from '../../../shared/harnessProfiles';
import { isSameWorkspaceIdentity, normalizeWorkspacePath } from '../../../shared/workspaceIdentity';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { attachAssistantTerminal, closeAssistantTerminal, focusWorkspaceTerminal } from '../../lib/assistantLaunch';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import './AssistantsSettings.css';

type PendingLaunch = {
  profileId: string;
  owner: { id: string; workspacePath: string; environmentId?: string };
};

/** The same native-profile controls are available in Settings in either navigation mode. */
export default function AssistantsSettings({ variant = 'settings' }: { variant?: 'settings' | 'sidebar' }) {
  const { snapshot, error, busy, setError, setBusy, run } = useAssistantsSnapshot();
  const [profileName, setProfileName] = useState('');
  const [pending, setPending] = useState<PendingLaunch | null>(null);
  const [manage, setManage] = useState(false);
  const workspace = useWorkspaceStore((state) => state.getWorkspaceById(state.activeWorkspaceId));
  const local = !!workspace && (!workspace.environmentId || workspace.environmentId === 'local');
  const location = workspace ? {
    environmentId: workspace.environmentId || 'local', path: normalizeWorkspacePath(workspace.workspacePath),
  } : undefined;
  const managing = variant === 'settings' || manage;
  const matchesPin = (pin: AssistantPin, profile: AssistantProfile, here: boolean) =>
    pin.harnessId === profile.harnessId && pin.profileName === profile.profileName
    && (here ? !!pin.workspace && !!location && isSameWorkspaceIdentity(pin.workspace, location) : !pin.workspace);
  const visiblePin = (pin: AssistantPin) => !pin.workspace || (!!location && isSameWorkspaceIdentity(pin.workspace, location));

  const togglePin = (profile: AssistantProfile, here: boolean) => {
    if (!snapshot || (here && !location)) return;
    const exists = snapshot.settings.pins.some((pin) => matchesPin(pin, profile, here));
    const pins = exists ? snapshot.settings.pins.filter((pin) => !matchesPin(pin, profile, here))
      : [...snapshot.settings.pins, {
        harnessId: profile.harnessId, profileName: profile.profileName, ...(here ? { workspace: location } : {}),
      }];
    void run(() => window.electronAPI.configureAssistants({ ...snapshot.settings, pins }));
  };
  const launch = async () => {
    if (!pending) return;
    const { profileId, owner } = pending;
    setPending(null);
    const current = useWorkspaceStore.getState().getWorkspaceById(owner.id);
    if (!current || (current.environmentId && current.environmentId !== 'local') || !isSameWorkspaceIdentity(
      { path: current.workspacePath, environmentId: current.environmentId },
      { path: owner.workspacePath, environmentId: owner.environmentId },
    )) {
      setError('Launch workspace was closed or replaced. Select a local workspace and try again.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.launchAssistant({ profileId, workspaceId: owner.id, acknowledgeExternalActivity: true });
      await attachAssistantTerminal(result, owner);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (variant === 'sidebar' && !snapshot?.settings.enabled) return null;
  const profiles = snapshot?.profiles.filter((profile) => managing
    || snapshot.settings.pins.some((pin) => visiblePin(pin) && pin.harnessId === profile.harnessId && pin.profileName === profile.profileName)
    || snapshot.launches.some((launch) => launch.profileId === profile.id)) ?? [];
  const missing = snapshot?.settings.pins.filter((pin) => (managing || visiblePin(pin))
    && !snapshot.profiles.some((profile) => profile.harnessId === pin.harnessId && profile.profileName === pin.profileName)) ?? [];

  return <section className={`assistants settings-section assistants-${variant}`} aria-label="Assistants">
    <div className="assistants-heading">
      <div className="settings-section-title">Assistants</div>
      {variant === 'sidebar' && <Button size="xs" variant="ghost" aria-label="Manage Assistants" aria-expanded={manage} onClick={() => setManage(!manage)}>Manage</Button>}
    </div>
    {managing && <label className="settings-option">
      <input type="checkbox" checked={snapshot?.settings.enabled ?? false} disabled={!snapshot || busy}
        onChange={(event) => {
          const enabled = event.target.checked;
          if (!snapshot) return;
          void run(async () => {
            const value = await window.electronAPI.configureAssistants({ ...snapshot.settings, enabled });
            return enabled ? window.electronAPI.discoverAssistants() : value;
          });
        }} />Enable Assistants (optional)
    </label>}
    {snapshot?.settings.enabled && <>
      {workspace && !local && <p className="assistants-note">Assistants launch in local workspaces only; SSH is not supported.</p>}
      {managing && <>
        <p className="assistants-note">Use existing native Hermes profiles. This does not create profiles or change native defaults.</p>
        <form className="assistants-manual" onSubmit={(event) => {
          event.preventDefault();
          if (isValidHarnessProfileName(profileName)) void run(() => window.electronAPI.addAssistantProfile('hermes', profileName));
        }}>
          <Input isInvalid={!!profileName && !isValidHarnessProfileName(profileName)} aria-label="Existing Hermes profile name" placeholder="Existing profile name" value={profileName} onChange={(event) => setProfileName(event.target.value)} disabled={busy} />
          <Button type="submit" size="xs" disabled={busy || !isValidHarnessProfileName(profileName)}>Add existing profile</Button>
        </form>
      </>}
      <Button size="xs" disabled={busy} onClick={() => void run(() => window.electronAPI.discoverAssistants())}>Refresh profiles</Button>
      {missing.map((pin, index) => <div className="assistant-card" key={`${pin.harnessId}:${pin.profileName}:${index}`}>
        <span>{pin.profileName} — unavailable</span>
        <p className="assistants-note">Refresh or add the existing native name to recover this pin.</p>
        <Button size="xs" disabled={busy} onClick={() => void run(() => window.electronAPI.configureAssistants({
          ...snapshot.settings, pins: snapshot.settings.pins.filter((candidate) => candidate !== pin),
        }))}>Remove unavailable pin</Button>
      </div>)}
      {profiles.map((profile) => <div className="assistant-card" key={profile.id}>
        <span className="assistant-label">{profile.label}</span>
        {profile.description && <p className="assistants-note">{profile.description}</p>}
        <div className="assistants-actions">
          {snapshot.launches.filter((launch) => launch.profileId === profile.id).map((launch) =>
            <div className="assistants-actions" key={launch.terminalId}>
              <Button size="xs" onClick={() => {
                if (!focusWorkspaceTerminal(launch.workspaceId, launch.terminalId)) setError('Owned terminal is unavailable. Refresh profiles and try again.');
              }}>Focus existing</Button>
              <Button size="xs" disabled={busy} onClick={() => void run(async () => {
                await closeAssistantTerminal(launch.workspaceId, launch.terminalId);
                return window.electronAPI.getAssistants();
              })}>Close terminal</Button>
            </div>)}
          <Button size="xs" disabled={busy || !local || snapshot.launches.some((launch) => launch.profileId === profile.id)}
            title={snapshot.launches.some((launch) => launch.profileId === profile.id) ? 'Profile already has an owned terminal. Focus it or close it before starting a new task.' : undefined} onClick={() => {
            if (workspace && local) setPending({ profileId: profile.id, owner: {
              id: workspace.id, workspacePath: workspace.workspacePath, environmentId: workspace.environmentId,
            } });
          }}>New task here</Button>
        </div>
        {managing && <div className="assistants-pins">
          <label><input type="checkbox" aria-label={`Pin ${profile.label} globally`} disabled={busy} checked={snapshot.settings.pins.some((pin) => matchesPin(pin, profile, false))} onChange={() => togglePin(profile, false)} />Global pin</label>
          <label><input type="checkbox" aria-label={`Pin ${profile.label} here`} disabled={busy || !location} checked={snapshot.settings.pins.some((pin) => matchesPin(pin, profile, true))} onChange={() => togglePin(profile, true)} />Workspace pin</label>
        </div>}
      </div>)}
      {!profiles.length && !missing.length && <p className="assistants-note">{managing ? 'No profiles found. Refresh or add an existing native profile name.' : 'Pin an existing profile from Manage.'}</p>}
    </>}
    {(error || snapshot?.discoveryError) && <p className="assistants-error" role="alert">{error || snapshot?.discoveryError}</p>}
    {!snapshot && error && <Button size="xs" disabled={busy} onClick={() => void run(() => window.electronAPI.getAssistants())}>Retry settings</Button>}
    <Dialog open={!!pending} onOpenChange={(open) => { if (!open) setPending(null); }}>
      <DialogContent className="assistants-warning" workspaceId={pending?.owner.id}>
        <div className="clanker-dialog-header"><DialogTitle className="clanker-dialog-title">Launch existing profile?</DialogTitle></div>
        <DialogDescription className="clanker-dialog-body">External activity is unknown. Clanker cannot tell whether this profile is already running outside this app. Native profile files may be shared; check other terminals before launching.</DialogDescription>
        <div className="clanker-dialog-footer">
          <Button onClick={() => setPending(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => void launch()}>Acknowledge and launch</Button>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
