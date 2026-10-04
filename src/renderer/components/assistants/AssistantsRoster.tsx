import { useEffect } from 'react';
import { getHarnessOption } from '../../lib/harnessOptions';
import { useAssistantsStore } from '../../store/assistantsStore';
import { useAssistantNavStore } from '../../store/assistantNavStore';
import type { HermesAssistantServiceState, HermesAssistant } from '../../../shared/types/assistants';
import { Button } from '../ui/Button';
import './AssistantsRoster.css';

/** Assistants to list: the live roster plus any opened Assistant the service no longer reports (kept, shown offline). */
export function useAssistantRoster(): { assistants: HermesAssistant[]; live: Set<string> } {
  const snapshot = useAssistantsStore((state) => state.snapshot);
  const knownAssistants = useAssistantsStore((state) => state.knownAssistants);
  const openedAssistantIds = useAssistantNavStore((state) => state.openedAssistantIds);
  const live = new Set((snapshot?.assistants ?? []).map((assistant) => assistant.id));
  const assistants = [...(snapshot?.assistants ?? [])];
  for (const id of openedAssistantIds) if (!live.has(id) && knownAssistants[id]) assistants.push(knownAssistants[id]);
  return { assistants, live };
}

const STATUS_TEXT: Partial<Record<HermesAssistantServiceState, string>> = {
  probing: 'Connecting to Hermes…',
  starting: 'Starting Hermes service…',
  offline: 'Hermes service is not running',
  'detected-unusable': 'Hermes service found, but Clanker cannot connect to it',
  error: 'Hermes service could not be started',
};

/** Whether the Assistants section exists at all. Disabled means no section, no probing, no auto-start. */
export function useAssistantsEnabled(): boolean {
  const ensure = useAssistantsStore((state) => state.ensureSubscribed);
  useEffect(() => { ensure(); }, [ensure]);
  // Hidden entirely unless the Hermes CLI is installed (main's canonical harness availability) and the user opted in.
  return useAssistantsStore((state) => state.snapshot?.available === true && state.snapshot.settings.enabled === true);
}

export function AssistantButton({ assistant, live, variant, disabled = false }: { assistant: HermesAssistant; live: boolean; variant: 'row' | 'icon' | 'launcher'; disabled?: boolean }) {
  const active = useAssistantNavStore((state) => state.activeAssistantId === assistant.id);
  const openAssistantSurface = useAssistantNavStore((state) => state.openAssistantSurface);
  const HermesIcon = getHarnessOption('hermes').Icon;
  const label = `${assistant.displayName} · Hermes Assistant`;
  const title = assistant.description ? `${label}\n${assistant.description}` : label;
  return (
    <button
      type="button"
      className={`${variant === 'launcher' ? 'assistant-launcher-button' : `assistant-${variant}`}${active ? ' active' : ''}${live ? '' : ' offline'}`}
      aria-current={active ? 'true' : undefined}
      aria-label={variant === 'icon' ? label : undefined}
      title={title}
      disabled={disabled}
      onClick={() => openAssistantSurface(assistant.id)}
    >
      <HermesIcon size={14} strokeWidth={2} aria-hidden="true" />
      {variant === 'launcher' && <span className="assistant-name">{assistant.displayName}</span>}
      {variant === 'row' && <><span className="assistant-name">{assistant.displayName}</span><span className={`assistant-dot${live ? ' live' : ''}`} aria-hidden="true" /></>}
    </button>
  );
}

/**
 * Sidebar (and compact strip) roster: one row per Assistant; click opens/focuses its canonical Bot Chat.
 * The `launcher` variant is the fullscreen startup launcher's section: the same service state and statuses,
 * but only the live roster is launchable (an opened-then-offline Assistant is not offered from a cold start),
 * and `disabled` lets the launcher's own busy state block it while a workspace/recipe opens.
 */
export default function AssistantsRoster({ variant = 'sidebar', disabled = false }: { variant?: 'sidebar' | 'strip' | 'launcher'; disabled?: boolean }) {
  const enabled = useAssistantsEnabled();
  const snapshot = useAssistantsStore((state) => state.snapshot);
  const refresh = useAssistantsStore((state) => state.refresh);
  const busy = useAssistantsStore((state) => state.busy);
  const { assistants: rosterAssistants, live } = useAssistantRoster();
  if (!enabled || !snapshot) return null;
  const state = snapshot.service.state;
  const assistants = variant === 'launcher' ? rosterAssistants.filter((assistant) => live.has(assistant.id) && state === 'connected') : rosterAssistants;
  const status = state === 'connected' ? (assistants.length === 0 ? 'No Hermes Assistants found' : null) : STATUS_TEXT[state] ?? null;
  const retry = state === 'offline' || state === 'error' || state === 'detected-unusable';
  return (
    <section className={`assistants-roster assistants-roster-${variant}`} aria-label="Assistants">
      <div className="assistants-roster-heading">Assistants</div>
      <div className="assistants-roster-list">
        {assistants.map((assistant) => <AssistantButton key={assistant.id} assistant={assistant} live={live.has(assistant.id) && state === 'connected'} variant={variant === 'launcher' ? 'launcher' : 'row'} disabled={disabled} />)}
      </div>
      {snapshot.service.error && state !== 'connected'
        ? <p className="assistants-roster-error" role="alert">{snapshot.service.error}</p>
        : status && <p className="assistants-roster-status" role="status">{status}</p>}
      {retry && <Button size="xs" disabled={busy} onClick={() => void refresh()}>Retry</Button>}
    </section>
  );
}
