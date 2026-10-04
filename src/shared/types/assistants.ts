/**
 * Optional Hermes Assistants: an app-level integration with Hermes Bot Mode through a local
 * `hermes serve` backend. Durable state is two booleans; everything else is main-owned runtime
 * state. Nothing here carries a backend token, URL, profile home or config path.
 */
export interface AssistantSettings {
  enabled: boolean;
  /** Start a Clanker-owned `hermes serve` when no compatible backend is already running. */
  autoStart: boolean;
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
  settings: AssistantSettings;
  service: {
    state: HermesAssistantServiceState;
    ownership: 'external' | 'clanker' | null;
    /** Display-safe: never contains a token, URL or host path. */
    error?: string;
  };
  assistants: HermesAssistant[];
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
