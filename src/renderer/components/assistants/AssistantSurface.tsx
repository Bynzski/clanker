import { useEffect, useRef } from 'react';
import { useAssistantsStore } from '../../store/assistantsStore';
import { useThemeStore } from '../../theme/themeStore';
import { getTerminalTheme, registerThemedTerminal, unregisterThemedTerminal } from '../../theme/terminalTheme';
import { TERMINAL_DEFAULT_FONT_SIZE, TERMINAL_SCROLLBACK_LINES } from '../../../shared/terminal';
import type { AssistantSurfaceState } from '../../../shared/types/assistants';
import { Button } from '../ui/Button';
import '@xterm/xterm/css/xterm.css';
import './AssistantsRoster.css';

type XTermInstance = import('@xterm/xterm').Terminal;
type FitInstance = import('@xterm/addon-fit').FitAddon;

const OVERLAY_TEXT: Partial<Record<AssistantSurfaceState, string>> = {
  connecting: 'Connecting to Bot Chat…',
  disconnected: 'Disconnected from the Hermes service.',
  ended: 'This Bot Chat session ended.',
  unavailable: 'Could not open this Assistant\'s chat. Nothing was changed.',
};

/**
 * One persistent surface per Bot: the service-hosted canonical Bot Chat (`/api/pty`) rendered in xterm.
 * It stays mounted (parked) while another surface is active so an in-flight turn is never ended by
 * navigation. Input/output cross the narrow Assistant IPC; Hermes' TUI owns its own content.
 */
export default function AssistantSurface({ botId, displayName, isActive }: { botId: string; displayName: string; isActive: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTermInstance | null>(null);
  const fitRef = useRef<FitInstance | null>(null);
  const activeRef = useRef(isActive);
  activeRef.current = isActive;
  const snapshot = useAssistantsStore((state) => state.snapshot);
  const refresh = useAssistantsStore((state) => state.refresh);
  const ensureSubscribed = useAssistantsStore((state) => state.ensureSubscribed);
  useEffect(() => { ensureSubscribed(); }, [ensureSubscribed]);
  const surface = snapshot?.surfaces.find((entry) => entry.botId === botId);
  const serviceConnected = snapshot?.service.state === 'connected';
  const surfaceState = surface?.state;

  const fitAndResize = () => {
    const xterm = xtermRef.current; const fit = fitRef.current; const host = hostRef.current;
    if (!xterm || !fit || !host || !activeRef.current || host.offsetWidth === 0) return;
    try { fit.fit(); } catch { return; }
    void window.electronAPI.resizeAssistantPty(botId, xterm.cols, xterm.rows);
  };

  // Mount: create xterm once, wire IO, open (or re-attach) the main-owned surface.
  useEffect(() => {
    let cancelled = false;
    let disposeData: (() => void) | undefined;
    let observer: ResizeObserver | undefined;
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(async ([xtermModule, fitModule]) => {
      if (cancelled || !hostRef.current) return;
      const xterm = new xtermModule.Terminal({
        theme: getTerminalTheme(useThemeStore.getState().theme),
        fontFamily: '"DejaVu Sans Mono", "JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace',
        fontSize: TERMINAL_DEFAULT_FONT_SIZE, cursorBlink: true, allowProposedApi: true, scrollback: TERMINAL_SCROLLBACK_LINES,
      });
      const fit = new fitModule.FitAddon();
      xterm.loadAddon(fit);
      xterm.open(hostRef.current);
      xtermRef.current = xterm; fitRef.current = fit;
      registerThemedTerminal(xterm, useThemeStore.getState().theme);
      xterm.onData((data) => { void window.electronAPI.writeAssistantPty(botId, data); });
      disposeData = window.electronAPI.onAssistantPtyData((payload) => { if (payload.botId === botId) xterm.write(payload.data); });
      try {
        const opened = await window.electronAPI.openAssistant(botId);
        if (!cancelled && opened.replay) xterm.write(opened.replay);
      } catch { /* the overlay reflects the service state */ }
      if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(fitAndResize); observer.observe(hostRef.current); }
      fitAndResize();
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      disposeData?.();
      observer?.disconnect();
      const xterm = xtermRef.current;
      if (xterm) { unregisterThemedTerminal(xterm); xterm.dispose(); }
      xtermRef.current = null; fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  // Re-attach to the same canonical chat after a disconnect once the service is back; never creates a scratch chat.
  useEffect(() => {
    if (surfaceState === 'disconnected' && serviceConnected) void window.electronAPI.openAssistant(botId).catch(() => undefined);
  }, [surfaceState, serviceConnected, botId]);

  useEffect(() => {
    if (!isActive) return;
    const timer = setTimeout(() => { fitAndResize(); xtermRef.current?.focus(); }, 30);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  const overlay = !serviceConnected
    ? (snapshot?.service.state === 'probing' || snapshot?.service.state === 'starting' ? 'Connecting to Hermes…' : 'Hermes service is not running.')
    : surfaceState && surfaceState !== 'open' ? OVERLAY_TEXT[surfaceState] : undefined;

  return (
    <section className={`assistant-surface ${isActive ? 'active' : 'parked'}`} data-assistant-id={botId} aria-hidden={!isActive} aria-label={`${displayName} Bot Chat`}>
      <div className="assistant-surface-header">{displayName} · Hermes Bot Chat</div>
      <div className="assistant-surface-terminal" ref={hostRef} />
      {overlay && (
        <div className="assistant-surface-overlay" role="status">
          <p>{overlay}</p>
          {!serviceConnected && <Button size="xs" onClick={() => void refresh()}>Reconnect</Button>}
          {serviceConnected && surfaceState === 'ended' && <Button size="xs" onClick={() => void window.electronAPI.openAssistant(botId).catch(() => undefined)}>Reopen</Button>}
          {serviceConnected && surfaceState === 'unavailable' && <Button size="xs" onClick={() => void window.electronAPI.openAssistant(botId).catch(() => undefined)}>Retry</Button>}
        </div>
      )}
    </section>
  );
}
