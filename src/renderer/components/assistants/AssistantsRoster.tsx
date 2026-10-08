import { useEffect } from 'react';
import { getHarnessOption } from '../../lib/harnessOptions';
import { useAssistantsStore } from '../../store/assistantsStore';
import { useAssistantNavStore } from '../../store/assistantNavStore';
import type { HermesAssistantServiceState, HermesAssistant } from '../../../shared/types/assistants';
import { Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
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

/** Compact service notice shared by the sidebar and Settings: tone icon, message, optional retry icon. */
export function AssistantNotice({ tone, message, onRetry, busy = false }: { tone: 'info' | 'error'; message: string; onRetry?: () => void; busy?: boolean }) {
  const Icon = tone === 'error' ? TriangleAlert : Info;
  return (
    <div className={`assistants-roster-notice${tone === 'error' ? ' error' : ''}`}>
      <Icon size={13} aria-hidden="true" />
      <p role={tone === 'error' ? 'alert' : 'status'}>{message}</p>
      {onRetry && <IconButton variant="ghost" size="xs" disabled={busy} aria-label="Retry" title="Retry" onClick={onRetry}><RefreshCw size={12} aria-hidden="true" /></IconButton>}
    </div>
  );
}

export function AssistantButton({ assistant, live, variant, disabled = false }: { assistant: HermesAssistant; live: boolean; variant: 'row' | 'icon'; disabled?: boolean }) {
  const active = useAssistantNavStore((state) => state.activeAssistantId === assistant.id);
  const openAssistantSurface = useAssistantNavStore((state) => state.openAssistantSurface);
  const HermesIcon = getHarnessOption('hermes').Icon;
  const label = `${assistant.displayName} · Hermes Assistant`;
  const title = assistant.description ? `${label}\n${assistant.description}` : label;
  return (
    <button
      type="button"
      className={`assistant-${variant}${active ? ' active' : ''}${live ? '' : ' offline'}`}
      aria-current={active ? 'true' : undefined}
      aria-label={variant === 'icon' ? label : assistant.displayName}
      title={title}
      disabled={disabled}
      onClick={() => openAssistantSurface(assistant.id)}
    >
      {variant === 'row'
        ? <>
          <span className="assistant-avatar" aria-hidden="true"><HermesIcon size={14} strokeWidth={2} /></span>
          <span className="assistant-text">
            <span className="assistant-name">{assistant.displayName}</span>
            <span className="assistant-sub">{assistant.description || 'Hermes Assistant'}</span>
          </span>
          {/* Listed means available, so only the exception is shown. */}
          {!live && <span className="assistant-offline">offline</span>}
        </>
        : <HermesIcon size={14} strokeWidth={2} aria-hidden="true" />}
    </button>
  );
}

/**
 * Sidebar (and compact strip) roster: one row per Assistant; click opens/focuses its canonical Bot Chat.
 */
export default function AssistantsRoster({ variant = 'sidebar', disabled = false }: { variant?: 'sidebar' | 'strip'; disabled?: boolean }) {
  const enabled = useAssistantsEnabled();
  const snapshot = useAssistantsStore((state) => state.snapshot);
  const refresh = useAssistantsStore((state) => state.refresh);
  const busy = useAssistantsStore((state) => state.busy);
  const { assistants, live } = useAssistantRoster();
  if (!enabled || !snapshot) return null;
  const state = snapshot.service.state;
  const status = state === 'connected' ? (assistants.length === 0 ? 'No Hermes Assistants found' : null) : STATUS_TEXT[state] ?? null;
  const retry = state === 'offline' || state === 'error' || state === 'detected-unusable';
  return (
    <section className={`assistants-roster assistants-roster-${variant}`} aria-label="Assistants">
      <div className="assistants-roster-heading">Assistants</div>
      <div className="assistants-roster-list">
        {assistants.map((assistant) => <AssistantButton key={assistant.id} assistant={assistant} live={live.has(assistant.id) && state === 'connected'} variant="row" disabled={disabled} />)}
      </div>
      {(snapshot.service.error && state !== 'connected') || status
        ? <AssistantNotice tone={snapshot.service.error && state !== 'connected' ? 'error' : 'info'} message={(state !== 'connected' && snapshot.service.error) || status!}
          onRetry={retry ? () => void refresh() : undefined} busy={busy} />
        : null}
    </section>
  );
}
