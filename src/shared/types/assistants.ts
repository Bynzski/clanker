/**
 * Optional Hermes Assistants: an app-level integration with named Hermes profiles through a local
 * `hermes serve` backend; each Assistant resolves Hermes' canonical "Bot Chat". Durable state is two
 * booleans and bounded Clanker-only hidden IDs; everything else is main-owned runtime state. Nothing here carries a backend token, URL,
 * profile home or config path.
 */
export interface AssistantSettings {
  enabled: boolean;
  /** Start a Clanker-owned `hermes serve` when no compatible backend is already running. */
  autoStart: boolean;
  /** Clanker-only roster visibility; never changes the Hermes profile or its chat. */
  hiddenAssistantIds?: string[];
}

export function isValidAssistantId(value: unknown): value is string {
  return typeof value === 'string' && /^hermes:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = { enabled: false, autoStart: false };

export type HermesAssistantServiceState =
  | 'disabled'
  | 'probing'
  | 'starting'
  | 'connected'
  | 'offline'
  | 'error'
  | 'detected-unusable';

export interface HermesAssistant {
  activity?: import('./assistantDetails').AssistantActivity;
  /** Hermes' own hidden preference, descriptive only; Clanker does not write ui_meta. */
  hiddenInHermes?: boolean;
  /** Opaque Clanker id (never the display name); the only handle the renderer sends back. */
  id: string;
  displayName: string;
  description?: string;
}

export type AssistantSurfaceState = 'connecting' | 'open' | 'disconnected' | 'ended' | 'unavailable';

export interface AssistantSurfaceStatus {
  assistantId: string;
  state: AssistantSurfaceState;
}

export interface AssistantSnapshot {
  /** The local Hermes CLI is installed (canonical harness availability). False means the feature is dormant and hidden. */
  available: boolean;
  /** Ephemeral presentation generation; explicit roster refresh invalidates avatar thumbnails. */
  presentationRevision?: number;
  settings: AssistantSettings;
  service: {
    state: HermesAssistantServiceState;
    ownership: 'external' | 'clanker' | null;
    /** Display-safe: never contains a token, URL or host path. */
    error?: string;
  };
  assistants: HermesAssistant[];
  /** Complete named-profile catalog for Settings, including locally/Hermes-hidden entries. */
  profiles?: HermesAssistant[];
  surfaces: AssistantSurfaceStatus[];
}

export interface AssistantPtyData {
  assistantId: string;
  data: string;
}

export interface AssistantOpenResult {
  state: AssistantSurfaceState;
  /** Recent output (bounded) so a re-mounted xterm can repaint. */
  replay: string;
}
