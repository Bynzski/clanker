import { useEffect } from 'react';
import { getHarnessOption } from '../../lib/harnessOptions';
import { useAssistantsStore } from '../../store/assistantsStore';
import { useAssistantNavStore } from '../../store/assistantNavStore';
import type { HermesAssistantServiceState, HermesBot } from '../../../shared/types/assistants';
import { Button } from '../ui/Button';
import './AssistantsRoster.css';

/** Bots to list: the live roster plus any opened Bot the service no longer reports (kept, shown offline). */
export function useRosterBots(): { bots: HermesBot[]; live: Set<string> } {
  const snapshot = useAssistantsStore((state) => state.snapshot);
  const knownBots = useAssistantsStore((state) => state.knownBots);
  const openedBotIds = useAssistantNavStore((state) => state.openedBotIds);
  const live = new Set((snapshot?.bots ?? []).map((bot) => bot.id));
  const bots = [...(snapshot?.bots ?? [])];
  for (const id of openedBotIds) if (!live.has(id) && knownBots[id]) bots.push(knownBots[id]);
  return { bots, live };
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

export function BotButton({ bot, live, variant }: { bot: HermesBot; live: boolean; variant: 'row' | 'icon' }) {
  const active = useAssistantNavStore((state) => state.activeBotId === bot.id);
  const openBot = useAssistantNavStore((state) => state.openBot);
  const HermesIcon = getHarnessOption('hermes').Icon;
  const label = `${bot.displayName} · Hermes Assistant`;
  const title = bot.description ? `${label}\n${bot.description}` : label;
  return (
    <button
      type="button"
      className={`assistant-${variant}${active ? ' active' : ''}${live ? '' : ' offline'}`}
      aria-current={active ? 'true' : undefined}
      aria-label={variant === 'icon' ? label : undefined}
      title={title}
      onClick={() => openBot(bot.id)}
    >
      <HermesIcon size={14} strokeWidth={2} aria-hidden="true" />
      {variant === 'row' && <><span className="assistant-name">{bot.displayName}</span><span className={`assistant-dot${live ? ' live' : ''}`} aria-hidden="true" /></>}
    </button>
  );
}

/** Sidebar (and compact strip) roster: one row per Bot; click opens/focuses its canonical Bot Chat. */
export default function AssistantsRoster({ variant = 'sidebar' }: { variant?: 'sidebar' | 'strip' }) {
  const enabled = useAssistantsEnabled();
  const snapshot = useAssistantsStore((state) => state.snapshot);
  const refresh = useAssistantsStore((state) => state.refresh);
  const busy = useAssistantsStore((state) => state.busy);
  const { bots, live } = useRosterBots();
  if (!enabled || !snapshot) return null;
  const state = snapshot.service.state;
  const status = state === 'connected' ? (bots.length === 0 ? 'No Hermes Assistants found' : null) : STATUS_TEXT[state] ?? null;
  const retry = state === 'offline' || state === 'error' || state === 'detected-unusable';
  return (
    <section className={`assistants-roster assistants-roster-${variant}`} aria-label="Assistants">
      <div className="assistants-roster-heading">Assistants</div>
      <div className="assistants-roster-list">
        {bots.map((bot) => <BotButton key={bot.id} bot={bot} live={live.has(bot.id) && state === 'connected'} variant="row" />)}
      </div>
      {snapshot.service.error && state !== 'connected'
        ? <p className="assistants-roster-error" role="alert">{snapshot.service.error}</p>
        : status && <p className="assistants-roster-status" role="status">{status}</p>}
      {retry && <Button size="xs" disabled={busy} onClick={() => void refresh()}>Retry</Button>}
    </section>
  );
}
